import http from "node:http";
import { readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateStoryboard, getOpenRouterApiKey, regenerateScene, retimeScenes } from "./lib/storyboard.mjs";
import { renderProject } from "./lib/renderer.mjs";
import {
  createJob,
  ensureProjectFolders,
  ensureStorage,
  getJob,
  getProject,
  listProjects,
  newId,
  nowIso,
  outputRoot,
  saveJob,
  saveProject,
  saveBufferedAsset,
  saveUploadedAsset
} from "./lib/storage.mjs";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(appRoot, "public");
const activeJobs = new Set();

loadEnv();
await ensureStorage();

if (isDirectRun()) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url);
        return;
      }
      await serveStatic(res, url.pathname);
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Internal server error." });
    }
  });

  const port = Number(process.env.PORT || 3000);
  server.listen(port, () => {
    console.log(`AI Video Automation App running at http://localhost:${port}`);
  });
}

export async function handleApi(req, res, url) {
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/api/projects") {
    sendJson(res, 200, { projects: await listProjects() });
    return;
  }

  if (req.method === "POST" && pathname === "/api/projects") {
    const isJson = String(req.headers["content-type"] || "").includes("application/json");
    const requestData = isJson ? await readJson(req) : await readFormData(req);
    const input = validateProjectInput({
      title: getRequestValue(requestData, "title"),
      contentType: getRequestValue(requestData, "contentType"),
      aspectRatio: getRequestValue(requestData, "aspectRatio"),
      targetDuration: getRequestValue(requestData, "targetDuration"),
      sourceText: getRequestValue(requestData, "sourceText"),
      sourceUrl: getRequestValue(requestData, "sourceUrl"),
      voice: getRequestValue(requestData, "voice") || "clear-ko",
      subtitlePreset: getRequestValue(requestData, "subtitlePreset") || "bold-bottom",
      backgroundMusic: getRequestValue(requestData, "backgroundMusic") || "none",
      brandColor: getRequestValue(requestData, "brandColor") || "#146ef5"
    });

    const projectId = newId("proj");
    await ensureProjectFolders(projectId);
    const assets = [];
    if (isJson) {
      for (const value of normalizeJsonAssets(requestData.assets)) {
        if (value.buffer.byteLength > 80 * 1024 * 1024) {
          sendJson(res, 413, { error: "Uploaded files must be smaller than 80 MB." });
          return;
        }
        assets.push(await saveBufferedAsset(projectId, value));
      }
    } else {
      for (const key of ["image", "audio", "asset"]) {
        for (const value of requestData.getAll(key)) {
          if (isFileLike(value) && value.size > 0) {
            if (value.size > 80 * 1024 * 1024) {
              sendJson(res, 413, { error: "Uploaded files must be smaller than 80 MB." });
              return;
            }
            assets.push(await saveUploadedAsset(projectId, value));
          }
        }
      }
    }

    const generated = await generateStoryboard(input);
    const imageAssets = assets.filter((asset) => asset.kind === "image");
    const scenes = generated.scenes.map((scene, index) => ({
      ...scene,
      assetId: imageAssets.length ? imageAssets[index % imageAssets.length].id : scene.assetId
    }));

    const timestamp = nowIso();
    const project = {
      id: projectId,
      ...input,
      sourceUrl: input.sourceUrl || undefined,
      status: "draft",
      aiProvider: generated.aiProvider,
      aiWarning: generated.aiWarning,
      assets,
      scenes,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await saveProject(project);
    sendJson(res, 201, { project });
    return;
  }

  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && req.method === "GET") {
    sendJson(res, 200, { project: await getProject(projectMatch[1]) });
    return;
  }

  if (projectMatch && req.method === "PATCH") {
    const project = await getProject(projectMatch[1]);
    const patch = await readJson(req);
    if (typeof patch.title === "string") project.title = clean(patch.title, 120);
    if (typeof patch.brandColor === "string" && /^#[0-9a-fA-F]{6}$/.test(patch.brandColor)) {
      project.brandColor = patch.brandColor;
    }
    if (Number.isFinite(Number(patch.targetDuration))) {
      project.targetDuration = clamp(Number(patch.targetDuration), 15, 180);
    }
    if (Array.isArray(patch.scenes) && patch.scenes.length > 0) {
      project.scenes = retimeScenes(patch.scenes.slice(0, 24));
    }
    await saveProject(project);
    sendJson(res, 200, { project });
    return;
  }

  const regenerateMatch = pathname.match(/^\/api\/projects\/([^/]+)\/regenerate-scene$/);
  if (regenerateMatch && req.method === "POST") {
    const project = await getProject(regenerateMatch[1]);
    const body = await readJson(req);
    const scene = await regenerateScene(project, String(body.sceneId || ""));
    project.scenes = retimeScenes(project.scenes.map((item) => (item.id === scene.id ? scene : item)));
    project.aiProvider = getOpenRouterApiKey() ? "openrouter" : "local";
    await saveProject(project);
    sendJson(res, 200, { project, scene });
    return;
  }

  const renderMatch = pathname.match(/^\/api\/projects\/([^/]+)\/render$/);
  if (renderMatch && req.method === "POST") {
    const project = await getProject(renderMatch[1]);
    if (project.status === "rendering") {
      sendJson(res, 409, { error: "A render is already running for this project." });
      return;
    }
    const job = await createJob(project.id);
    project.status = "rendering";
    project.latestJobId = job.id;
    await saveProject(project);
    if (process.env.VERCEL) {
      await renderProject(project, job.id);
      const completedJob = await getJob(job.id);
      const completedProject = await getProject(project.id);
      completedProject.status = completedJob.status === "completed" ? "completed" : "failed";
      completedProject.latestJobId = job.id;
      await saveProject(completedProject);
      sendJson(res, 200, { job: publicJob(completedJob) });
    } else {
      startRender(project, job.id);
      sendJson(res, 202, { job });
    }
    return;
  }

  const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (jobMatch && req.method === "GET") {
    sendJson(res, 200, { job: publicJob(await getJob(jobMatch[1])) });
    return;
  }

  const jobOutputMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/outputs\/([^/]+)$/);
  if (jobOutputMatch && req.method === "GET") {
    await serveJobOutput(req, res, jobOutputMatch[1], jobOutputMatch[2]);
    return;
  }

  const outputMatch = pathname.match(/^\/api\/projects\/([^/]+)\/outputs\/([^/]+)\/([^/]+)$/);
  if (outputMatch && req.method === "GET") {
    await serveOutput(req, res, outputMatch[1], outputMatch[2], outputMatch[3]);
    return;
  }

  sendJson(res, 404, { error: "Route not found." });
}

function isDirectRun() {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

function startRender(project, jobId) {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);
  renderProject(project, jobId)
    .then(async () => {
      const current = await getProject(project.id);
      current.status = "completed";
      current.latestJobId = jobId;
      await saveProject(current);
    })
    .catch(async (error) => {
      const message = error instanceof Error ? error.message : "Render failed.";
      const job = await getJob(jobId);
      await saveJob({
        ...job,
        status: "failed",
        stage: "Failed",
        error: message,
        progress: Math.max(job.progress || 0, 1)
      });
      const current = await getProject(project.id);
      current.status = "failed";
      current.latestJobId = jobId;
      await saveProject(current);
    })
    .finally(() => activeJobs.delete(jobId));
}

async function serveStatic(res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.resolve(publicRoot, `.${safePath}`);
  if (!resolved.startsWith(path.resolve(publicRoot))) {
    sendText(res, 403, "Forbidden");
    return;
  }
  try {
    const body = await fs.readFile(resolved);
    res.writeHead(200, {
      "Content-Type": contentType(resolved),
      "Cache-Control": "no-store"
    });
    res.end(body);
  } catch {
    sendText(res, 404, "Not found");
  }
}

const outputTargets = {
  video: {
    fileName: "final.mp4",
    type: "video/mp4",
    disposition: "inline",
    downloadName: "final-video.mp4",
    urlKey: "videoUrl"
  },
  srt: {
    fileName: "captions.srt",
    type: "text/plain; charset=utf-8",
    disposition: "attachment",
    downloadName: "captions.srt",
    urlKey: "srtUrl"
  },
  vtt: {
    fileName: "captions.vtt",
    type: "text/vtt; charset=utf-8",
    disposition: "attachment",
    downloadName: "captions.vtt",
    urlKey: "vttUrl"
  },
  json: {
    fileName: "project.json",
    type: "application/json; charset=utf-8",
    disposition: "attachment",
    downloadName: "project.json",
    urlKey: "projectJsonUrl"
  }
};

async function serveJobOutput(req, res, jobId, kind) {
  const job = await getJob(jobId);
  const target = outputTargets[kind];
  if (!target) {
    sendJson(res, 404, { error: "Unsupported output type." });
    return;
  }

  const inlineSource = inlineOutputSource(job, kind);
  if (inlineSource) {
    const parsed = parseDataUrl(inlineSource);
    if (!parsed) {
      sendJson(res, 500, { error: "Stored output is not a valid data URL." });
      return;
    }
    serveBuffer(req, res, parsed.buffer, parsed.type || target.type, target.disposition, target.downloadName);
    return;
  }

  if (job.projectId) {
    await serveOutput(req, res, job.projectId, jobId, kind);
    return;
  }

  sendJson(res, 404, { error: "Output file not found." });
}

async function serveOutput(req, res, projectId, jobId, kind) {
  const target = outputTargets[kind];
  if (!target) {
    sendJson(res, 404, { error: "Unsupported output type." });
    return;
  }

  try {
    const body = await fs.readFile(path.join(outputRoot(projectId, jobId), target.fileName));
    serveBuffer(req, res, body, target.type, target.disposition, target.downloadName);
  } catch {
    sendJson(res, 404, { error: "Output file not found." });
  }
}

function inlineOutputSource(job, kind) {
  const target = outputTargets[kind];
  const output = job?.output || {};
  const inlineFile = output.inlineFiles?.[kind];
  if (isDataUrl(inlineFile)) return inlineFile;
  const legacyUrl = output[target.urlKey];
  return isDataUrl(legacyUrl) ? legacyUrl : "";
}

function publicJob(job) {
  const copy = JSON.parse(JSON.stringify(job || {}));
  if (!copy.output) return copy;

  delete copy.output.inlineFiles;
  for (const [kind, target] of Object.entries(outputTargets)) {
    const hasInlineOutput = Boolean(job.output?.inlineFiles?.[kind]) || isDataUrl(job.output?.[target.urlKey]);
    if (hasInlineOutput) {
      copy.output[target.urlKey] = `/api/jobs/${copy.id}/outputs/${kind}`;
    }
  }
  return copy;
}

function serveBuffer(req, res, buffer, type, disposition, downloadName) {
  const range = parseRangeHeader(req.headers.range, buffer.byteLength);
  const baseHeaders = {
    "Accept-Ranges": "bytes",
    "Content-Type": type,
    "Content-Disposition": `${disposition}; filename="${downloadName}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  };

  if (range === "invalid") {
    res.writeHead(416, {
      ...baseHeaders,
      "Content-Range": `bytes */${buffer.byteLength}`
    });
    res.end();
    return;
  }

  if (range) {
    const chunk = buffer.subarray(range.start, range.end + 1);
    res.writeHead(206, {
      ...baseHeaders,
      "Content-Length": chunk.byteLength,
      "Content-Range": `bytes ${range.start}-${range.end}/${buffer.byteLength}`
    });
    res.end(chunk);
    return;
  }

  res.writeHead(200, {
    ...baseHeaders,
    "Content-Length": buffer.byteLength
  });
  res.end(buffer);
}

export function parseRangeHeader(header, size) {
  if (!header) return null;
  const match = String(header).match(/^bytes=(\d*)-(\d*)$/);
  if (!match || size < 1) return "invalid";

  let start;
  let end;
  if (match[1] === "") {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return "invalid";
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Number(match[2]);
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
    return "invalid";
  }

  return { start, end: Math.min(end, size - 1) };
}

export function parseDataUrl(value) {
  const match = String(value || "").match(/^data:([^,]*?)(;base64)?,([\s\S]*)$/);
  if (!match) return null;
  const type = match[1] || "application/octet-stream";
  const body = match[3] || "";
  const buffer = match[2] ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body), "utf8");
  return { type, buffer };
}

function isDataUrl(value) {
  return typeof value === "string" && value.startsWith("data:");
}

async function readFormData(req) {
  const request = new Request(`http://${req.headers.host || "localhost"}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: Readable.toWeb(req),
    duplex: "half"
  });
  return request.formData();
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function validateProjectInput(raw) {
  const input = {
    title: clean(raw.title, 120),
    contentType: String(raw.contentType || "educational"),
    aspectRatio: String(raw.aspectRatio || "vertical"),
    targetDuration: clamp(Number(raw.targetDuration || 45), 15, 180),
    sourceText: clean(raw.sourceText, 18_000),
    sourceUrl: clean(raw.sourceUrl || "", 500),
    voice: clean(raw.voice || "clear-ko", 80),
    subtitlePreset: clean(raw.subtitlePreset || "bold-bottom", 80),
    backgroundMusic: clean(raw.backgroundMusic || "none", 80),
    brandColor: clean(raw.brandColor || "#146ef5", 7)
  };
  if (input.title.length < 2) throw new Error("Title must be at least 2 characters.");
  if (input.sourceText.length < 20) throw new Error("Source text must be at least 20 characters.");
  if (!["educational", "news", "product", "healthcare", "shorts", "slideshow"].includes(input.contentType)) {
    input.contentType = "educational";
  }
  if (!["vertical", "landscape"].includes(input.aspectRatio)) input.aspectRatio = "vertical";
  if (!/^#[0-9a-fA-F]{6}$/.test(input.brandColor)) input.brandColor = "#146ef5";
  return input;
}

function clean(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function isFileLike(value) {
  return value && typeof value === "object" && typeof value.arrayBuffer === "function" && "size" in value;
}

function getRequestValue(source, key) {
  if (typeof source?.get === "function") return source.get(key);
  return source?.[key];
}

function normalizeJsonAssets(assets) {
  if (!Array.isArray(assets)) return [];
  return assets
    .map((asset) => {
      const data = String(asset?.data || "");
      const base64 = data.includes(",") ? data.split(",").pop() : data;
      if (!base64) return null;
      return {
        name: clean(asset.name || "asset.bin", 160),
        type: clean(asset.type || "application/octet-stream", 120),
        buffer: Buffer.from(base64, "base64")
      };
    })
    .filter(Boolean);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".mp4") return "video/mp4";
  return "application/octet-stream";
}

function loadEnv() {
  const candidates = [
    path.join(appRoot, ".env.local"),
    path.join(appRoot, ".env"),
    path.join(path.dirname(appRoot), ".env.local"),
    path.join(path.dirname(appRoot), ".env. local")
  ];
  for (const file of candidates) {
    try {
      const text = requireEnvFile(file);
      for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!match) continue;
        const [, key, rawValue] = match;
        if (!process.env[key]) process.env[key] = rawValue.replace(/^\uFEFF/, "").replace(/^["']|["']$/g, "").trim();
      }
    } catch {
      continue;
    }
  }
}

function requireEnvFile(filePath) {
  return readFileSync(filePath, "utf8");
}
