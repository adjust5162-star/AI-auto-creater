import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { appRoot, fileSize, getJob, outputRoot, resolveAssetPath, saveJob } from "./storage.mjs";
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
    await setJob(jobId, { stage: "Mixing uploaded audio", progress: 84 });
    await runFfmpeg(ffmpegPath, [
      "-y",
      "-i",
      silentPath,
      "-stream_loop",
      "-1",
      "-i",
      resolveAssetPath(project.id, audioAsset),
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
    await fs.copyFile(silentPath, finalPath);
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
  const imageAsset = scene.assetId
    ? project.assets.find((asset) => asset.id === scene.assetId && asset.kind === "image")
    : project.assets.find((asset) => asset.kind === "image");
  const duration = Math.max(3, Number(scene.duration) || 3);
  const withText = buildVideoFilter(spec.width, spec.height, scene.headline, Boolean(imageAsset));
  const noText = buildVideoFilter(spec.width, spec.height, "", Boolean(imageAsset));
  const args = imageAsset
    ? imageClipArgs(project, imageAsset, duration, withText, destination)
    : colorClipArgs(sceneIndex, spec, duration, withText, destination);

  try {
    await runFfmpeg(ffmpegPath, args);
  } catch (error) {
    const fallbackArgs = imageAsset
      ? imageClipArgs(project, imageAsset, duration, noText, destination)
      : colorClipArgs(sceneIndex, spec, duration, noText, destination);
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

function imageClipArgs(project, asset, duration, filter, destination) {
  return [
    "-y",
    "-loop",
    "1",
    "-t",
    String(duration),
    "-i",
    resolveAssetPath(project.id, asset),
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

function colorClipArgs(sceneIndex, spec, duration, filter, destination) {
  return [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${sceneColors[sceneIndex % sceneColors.length]}:s=${spec.width}x${spec.height}:d=${duration}:r=${spec.fps}`,
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

function buildVideoFilter(width, height, headline, fromImage) {
  const base = fromImage
    ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=30,format=yuv420p`
    : "format=yuv420p";
  if (!String(headline || "").trim()) return base;
  const fontPath = findFontPath();
  const font = fontPath ? `fontfile='${escapeFilterValue(fontPath.replaceAll("\\", "/"))}':` : "";
  const text = escapeFilterValue(shorten(headline, 54));
  return [
    base,
    `drawbox=x=0:y=${Math.round(height * 0.34)}:w=iw:h=${Math.round(height * 0.22)}:color=black@0.32:t=fill`,
    `drawtext=${font}text='${text}':fontcolor=white:fontsize=${Math.round(width * 0.052)}:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.54:boxborderw=${Math.round(width * 0.026)}`
  ].join(",");
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
