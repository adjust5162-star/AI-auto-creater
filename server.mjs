import http from "node:http";
import { readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateStoryboard, regenerateScene, retimeScenes } from "./lib/storyboard.mjs";
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
    const formData = await readFormData(req);
    const input = validateProjectInput({
      title: formData.get("title"),
      contentType: formData.get("contentType"),
      aspectRatio: formData.get("aspectRatio"),
      targetDuration: formData.get("targetDuration"),
      sourceText: formData.get("sourceText"),
      sourceUrl: formData.get("sourceUrl"),
      voice: formData.get("voice") || "clear-ko",
      subtitlePreset: formData.get("subtitlePreset") || "bold-bottom",
      backgroundMusic: formData.get("backgroundMusic") || "none",
      brandColor: formData.get("brandColor") || "#146ef5"
    });

    const projectId = newId("proj");
    await ensureProjectFolders(projectId);
    const assets = [];
    for (const key of ["image", "audio", "asset"]) {
      for (const value of formData.getAll(key)) {
        if (isFileLike(value) && value.size > 0) {
          if (value.size > 80 * 1024 * 1024) {
            sendJson(res, 413, { error: "Uploaded files must be smaller than 80 MB." });
            return;
          }
          assets.push(await saveUploadedAsset(projectId, value));
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
    project.aiProvider = process.env.OPENROUTER_API_KEY ? "openrouter" : "local";
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
      sendJson(res, 200, { job: completedJob });
    } else {
      startRender(project, job.id);
      sendJson(res, 202, { job });
    }
    return;
  }

  const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (jobMatch && req.method === "GET") {
    sendJson(res, 200, { job: await getJob(jobMatch[1]) });
    return;
  }

  const outputMatch = pathname.match(/^\/api\/projects\/([^/]+)\/outputs\/([^/]+)\/([^/]+)$/);
  if (outputMatch && req.method === "GET") {
    await serveOutput(res, outputMatch[1], outputMatch[2], outputMatch[3]);
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

async function serveOutput(res, projectId, jobId, kind) {
  const map = {
    video: ["final.mp4", "video/mp4", "inline", "final-video.mp4"],
    srt: ["captions.srt", "text/plain; charset=utf-8", "attachment", "captions.srt"],
    vtt: ["captions.vtt", "text/vtt; charset=utf-8", "attachment", "captions.vtt"],
    json: ["project.json", "application/json; charset=utf-8", "attachment", "project.json"]
  };
  const target = map[kind];
  if (!target) {
    sendJson(res, 404, { error: "Unsupported output type." });
    return;
  }
  const [fileName, type, disposition, downloadName] = target;
  try {
    const body = await fs.readFile(path.join(outputRoot(projectId, jobId), fileName));
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Disposition": `${disposition}; filename="${downloadName}"`,
      "Cache-Control": "no-store"
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: "Output file not found." });
  }
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
        if (!process.env[key]) process.env[key] = rawValue.replace(/^["']|["']$/g, "");
      }
    } catch {
      continue;
    }
  }
}

function requireEnvFile(filePath) {
  return readFileSync(filePath, "utf8");
}
