import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { appRoot, ensureAssetFile, fileSize, getJob, outputRoot, saveJob } from "./storage.mjs";
import { scenesToSrt, scenesToVtt } from "./subtitles.mjs";

const sceneColors = ["0x15202b", "0x123c69", "0x146ef5", "0x105f4f", "0x3a2f55", "0x5f3f2e"];
const require = createRequire(import.meta.url);

export async function renderProject(project, jobId) {
  const ffmpegPath = getFfmpegPath();
  const outputFolder = outputRoot(project.id, jobId);
  await fs.mkdir(outputFolder, { recursive: true });
  await setJob(jobId, { status: "running", stage: "Preparing subtitles", progress: 8 });

  const spec = getVideoSpec(project.aspectRatio);
  const scenes = [...project.scenes].sort((a, b) => a.index - b.index);
  await fs.writeFile(path.join(outputFolder, "captions.srt"), scenesToSrt(scenes), "utf8");
  await fs.writeFile(path.join(outputFolder, "captions.vtt"), scenesToVtt(scenes), "utf8");
  await fs.writeFile(path.join(outputFolder, "project.json"), `${JSON.stringify(project, null, 2)}\n`, "utf8");

  const clips = [];
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    const clipPath = path.join(outputFolder, `scene-${String(index + 1).padStart(2, "0")}.mp4`);
    await setJob(jobId, {
      stage: `Composing scene ${index + 1} of ${scenes.length}`,
      progress: Math.round(12 + (index / Math.max(1, scenes.length)) * 54)
    });
    await renderSceneClip(ffmpegPath, project, scene, clipPath, index, spec);
    clips.push(clipPath);
  }

  await setJob(jobId, { stage: "Joining scene clips", progress: 72 });
  const concatPath = path.join(outputFolder, "concat.txt");
  await fs.writeFile(concatPath, clips.map((clip) => `file '${toFfmpegPath(clip)}'`).join("\n"), "utf8");
  const silentPath = path.join(outputFolder, "silent.mp4");
  await runFfmpeg(ffmpegPath, ["-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", silentPath]);

  const finalPath = path.join(outputFolder, "final.mp4");
  const audioAsset = project.assets.find((asset) => asset.kind === "audio");
  if (audioAsset) {
    const audioPath = await ensureAssetFile(project.id, audioAsset);
    await setJob(jobId, { stage: "Mixing uploaded audio", progress: 84 });
    await runFfmpeg(ffmpegPath, [
      "-y",
      "-i",
      silentPath,
      "-stream_loop",
      "-1",
      "-i",
      audioPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-shortest",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      finalPath
    ]);
  } else {
    await setJob(jobId, { stage: "Optimizing MP4 playback", progress: 84 });
    await runFfmpeg(ffmpegPath, ["-y", "-i", silentPath, "-c", "copy", "-movflags", "+faststart", finalPath]);
  }

  const duration = scenes.reduce((sum, scene) => sum + scene.duration, 0);
  const output = process.env.VERCEL
    ? await inlineOutput(project, jobId, outputFolder, finalPath, duration, spec)
    : {
        videoUrl: `/api/projects/${project.id}/outputs/${jobId}/video`,
        srtUrl: `/api/projects/${project.id}/outputs/${jobId}/srt`,
        vttUrl: `/api/projects/${project.id}/outputs/${jobId}/vtt`,
        projectJsonUrl: `/api/projects/${project.id}/outputs/${jobId}/json`,
        duration,
        resolution: spec.label,
        fileSize: await fileSize(finalPath)
      };

  await setJob(jobId, {
    status: "completed",
    stage: "Completed",
    progress: 100,
    output
  });
}

async function inlineOutput(project, jobId, outputFolder, finalPath, duration, spec) {
  const inlineFiles = {
    video: await fileDataUrl(finalPath, "video/mp4"),
    srt: await fileDataUrl(path.join(outputFolder, "captions.srt"), "text/plain;charset=utf-8"),
    vtt: await fileDataUrl(path.join(outputFolder, "captions.vtt"), "text/vtt;charset=utf-8"),
    json: dataUrl(Buffer.from(JSON.stringify({ projectId: project.id, jobId, project }, null, 2), "utf8"), "application/json;charset=utf-8")
  };

  return {
    videoUrl: `/api/jobs/${jobId}/outputs/video`,
    srtUrl: `/api/jobs/${jobId}/outputs/srt`,
    vttUrl: `/api/jobs/${jobId}/outputs/vtt`,
    projectJsonUrl: `/api/jobs/${jobId}/outputs/json`,
    duration,
    resolution: spec.label,
    fileSize: await fileSize(finalPath),
    inline: true,
    inlineFiles
  };
}

async function fileDataUrl(filePath, mimeType) {
  return dataUrl(await fs.readFile(filePath), mimeType);
}

function dataUrl(buffer, mimeType) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function getFfmpegPath() {
  if (process.env.VERCEL) {
    const installed = getInstallerFfmpegPath();
    if (installed) return installed;
  }

  const bundled = path.join(appRoot, "bin", "ffmpeg.exe");
  if (existsSync(bundled)) return bundled;
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  const installed = getInstallerFfmpegPath();
  if (installed) return installed;
  return "ffmpeg";
}

function getInstallerFfmpegPath() {
  try {
    const candidate = require("@ffmpeg-installer/ffmpeg").path;
    return candidate && existsSync(candidate) ? candidate : "";
  } catch {
    return "";
  }
}

async function renderSceneClip(ffmpegPath, project, scene, destination, sceneIndex, spec) {
  const visualAsset = scene.assetId
    ? project.assets.find((asset) => asset.id === scene.assetId && (asset.kind === "image" || asset.kind === "video"))
    : project.assets.find((asset) => asset.kind === "image" || asset.kind === "video");
  const duration = Math.max(3, Number(scene.duration) || 3);
  const withText = buildVideoFilter(spec.width, spec.height, scene, Boolean(visualAsset));
  const noText = buildVideoFilter(spec.width, spec.height, null, Boolean(visualAsset));
  const visualPath = visualAsset ? await ensureAssetFile(project.id, visualAsset) : "";
  const args = visualAsset
    ? assetClipArgs(visualPath, visualAsset, duration, withText, destination)
    : colorClipArgs(project, sceneIndex, spec, duration, withText, destination);

  try {
    await runFfmpeg(ffmpegPath, args);
  } catch (error) {
    const fallbackArgs = visualAsset
      ? assetClipArgs(visualPath, visualAsset, duration, noText, destination)
      : colorClipArgs(project, sceneIndex, spec, duration, noText, destination);
    await runFfmpeg(ffmpegPath, fallbackArgs);
    const job = await getJobFromDestination(destination);
    if (job) {
      job.warnings.push(
        `Scene ${scene.index} text overlay was skipped because FFmpeg drawtext failed: ${summarizeFfmpegError(error)}`
      );
      await saveJob(job);
    }
  }
}

function assetClipArgs(assetPath, asset, duration, filter, destination) {
  return asset.kind === "video"
    ? videoClipArgs(assetPath, duration, filter, destination)
    : imageClipArgs(assetPath, duration, filter, destination);
}

function imageClipArgs(assetPath, duration, filter, destination) {
  return [
    "-y",
    "-loop",
    "1",
    "-t",
    String(duration),
    "-i",
    assetPath,
    "-f",
    "lavfi",
    "-t",
    String(duration),
    "-i",
    "anullsrc=r=48000:cl=stereo",
    "-shortest",
    "-vf",
    filter,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    destination
  ];
}

function videoClipArgs(assetPath, duration, filter, destination) {
  return [
    "-y",
    "-stream_loop",
    "-1",
    "-t",
    String(duration),
    "-i",
    assetPath,
    "-f",
    "lavfi",
    "-t",
    String(duration),
    "-i",
    "anullsrc=r=48000:cl=stereo",
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-shortest",
    "-vf",
    filter,
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    destination
  ];
}

function colorClipArgs(project, sceneIndex, spec, duration, filter, destination) {
  const color = normalizeFfmpegColor(project.brandColor) || sceneColors[sceneIndex % sceneColors.length];
  return [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=${spec.width}x${spec.height}:d=${duration}:r=${spec.fps}`,
    "-f",
    "lavfi",
    "-t",
    String(duration),
    "-i",
    "anullsrc=r=48000:cl=stereo",
    "-shortest",
    "-vf",
    filter,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    destination
  ];
}

function buildVideoFilter(width, height, scene, fromImage) {
  const base = fromImage
    ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=30,format=yuv420p`
    : "format=yuv420p";
  const headline = cleanForOverlay(typeof scene === "string" ? scene : scene?.headline);
  const narration = cleanForOverlay(typeof scene === "string" ? "" : scene?.narration);
  if (!headline && !narration) return base;

  const fontPath = findFontPath();
  const font = fontPath ? `fontfile='${escapeFilterValue(fontPath.replaceAll("\\", "/"))}':` : "";
  const vertical = height > width;
  const titleSize = Math.round(width * (vertical ? 0.074 : 0.046));
  const bodySize = Math.round(width * (vertical ? 0.042 : 0.026));
  const titleLines = wrapText(shorten(headline, vertical ? 38 : 70), vertical ? 12 : 26).slice(0, 3);
  const bodyLines = wrapText(shorten(narration, vertical ? 86 : 130), vertical ? 18 : 42).slice(0, 3);
  const lineGap = Math.round(width * 0.014);
  const titleLineHeight = Math.round(titleSize * 1.18);
  const bodyLineHeight = Math.round(bodySize * 1.32);
  const contentHeight =
    titleLines.length * titleLineHeight +
    (bodyLines.length ? Math.round(bodySize * 0.9) : 0) +
    bodyLines.length * bodyLineHeight;
  const panelHeight = Math.max(Math.round(height * 0.22), contentHeight + Math.round(height * 0.055));
  const panelY = Math.round((height - panelHeight) / 2);
  let y = panelY + Math.round(height * 0.03);
  const filters = [
    base,
    `drawbox=x=0:y=${Math.round(height * 0.08)}:w=iw:h=${Math.round(height * 0.015)}:color=white@0.18:t=fill`,
    `drawbox=x=${Math.round(width * 0.055)}:y=${panelY}:w=${Math.round(width * 0.89)}:h=${panelHeight}:color=black@${fromImage ? "0.58" : "0.42"}:t=fill`
  ];

  for (const line of titleLines) {
    filters.push(drawText(font, line, titleSize, y, "white"));
    y += titleLineHeight + lineGap;
  }
  if (bodyLines.length) y += Math.round(bodySize * 0.45);
  for (const line of bodyLines) {
    filters.push(drawText(font, line, bodySize, y, "0xf1f5f9"));
    y += bodyLineHeight;
  }

  return filters.join(",");
}

function findFontPath() {
  const candidates = [
    path.join(appRoot, "assets", "fonts", "NotoSansCJKkr-Regular.otf"),
    "C:/Windows/Fonts/malgun.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function getVideoSpec(aspectRatio) {
  return aspectRatio === "landscape"
    ? { width: 1920, height: 1080, fps: 30, label: "1920x1080" }
    : { width: 1080, height: 1920, fps: 30, label: "1080x1920" };
}

function shorten(text, max) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length <= max ? value : `${value.slice(0, max - 3).trim()}...`;
}

function cleanForOverlay(value) {
  return String(value || "")
    .replace(/[\uFEFF\u200B-\u200D\u2060]/g, "")
    .replace(/\uFFFD/g, "")
    .replace(/\s*\?{2,}\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wrapText(text, maxChars) {
  const value = cleanForOverlay(text);
  if (!value) return [];
  const words = value.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxChars) {
      if (current) lines.push(current);
      for (let index = 0; index < word.length; index += maxChars) {
        lines.push(word.slice(index, index + maxChars));
      }
      current = "";
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawText(font, text, size, y, color) {
  return `drawtext=${font}text='${escapeFilterValue(text)}':fontcolor=${color}:fontsize=${size}:x=(w-text_w)/2:y=${y}`;
}

function normalizeFfmpegColor(value) {
  const match = String(value || "").trim().match(/^#([0-9a-fA-F]{6})$/);
  return match ? `0x${match[1]}` : "";
}

function escapeFilterValue(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/%/g, "\\%");
}

function summarizeFfmpegError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /drawtext|font|filter|No such|Error|failed|Conversion/i.test(line));
  return shorten(lines.slice(-4).join(" | ") || message, 260);
}

function toFfmpegPath(filePath) {
  return filePath.replaceAll("\\", "/").replaceAll("'", "'\\''");
}

async function setJob(jobId, patch) {
  const job = await getJob(jobId);
  await saveJob({ ...job, ...patch, updatedAt: new Date().toISOString() });
}

async function getJobFromDestination(destination) {
  const parts = destination.split(path.sep);
  const outputsIndex = parts.lastIndexOf("outputs");
  const jobId = outputsIndex >= 0 ? parts[outputsIndex + 1] : undefined;
  if (!jobId) return null;
  try {
    return await getJob(jobId);
  } catch {
    return null;
  }
}

async function runFfmpeg(ffmpegPath, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 6000) stderr = stderr.slice(-6000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `FFmpeg exited with code ${code}.`));
    });
  });
}
