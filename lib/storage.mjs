import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getJobFromDb,
  getProjectFromDb,
  hasSupabaseStore,
  listProjectsFromDb,
  saveJobToDb,
  saveProjectToDb
} from "./db-store.mjs";

export const appRoot = path.resolve(path.dirname(fileURLToPath(new URL("../server.mjs", import.meta.url))));
export const dataRoot = path.join(process.env.VERCEL ? path.join("/tmp", "ai-video-automation-app") : appRoot, "data");
export const projectsRoot = path.join(dataRoot, "projects");
export const jobsRoot = path.join(dataRoot, "jobs");

export function newId(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export async function ensureStorage() {
  await fs.mkdir(projectsRoot, { recursive: true });
  await fs.mkdir(jobsRoot, { recursive: true });
}

export function projectRoot(projectId) {
  return path.join(projectsRoot, projectId);
}

export function uploadsRoot(projectId) {
  return path.join(projectRoot(projectId), "uploads");
}

export function outputsRoot(projectId) {
  return path.join(projectRoot(projectId), "outputs");
}

export function outputRoot(projectId, jobId) {
  return path.join(outputsRoot(projectId), jobId);
}

export function projectJsonPath(projectId) {
  return path.join(projectRoot(projectId), "project.json");
}

export function jobJsonPath(jobId) {
  return path.join(jobsRoot, `${jobId}.json`);
}

export async function ensureProjectFolders(projectId) {
  await fs.mkdir(uploadsRoot(projectId), { recursive: true });
  await fs.mkdir(outputsRoot(projectId), { recursive: true });
}

export async function listProjects() {
  if (hasSupabaseStore()) return listProjectsFromDb();

  await ensureStorage();
  const entries = await fs.readdir(projectsRoot, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      projects.push(await getProject(entry.name));
    } catch {
      continue;
    }
  }
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getProject(projectId) {
  if (hasSupabaseStore()) return getProjectFromDb(projectId);

  return JSON.parse(await fs.readFile(projectJsonPath(projectId), "utf8"));
}

export async function saveProject(project) {
  if (hasSupabaseStore()) {
    project.updatedAt = nowIso();
    await saveProjectToDb(project);
  }

  await ensureProjectFolders(project.id);
  project.updatedAt = nowIso();
  await fs.writeFile(projectJsonPath(project.id), `${JSON.stringify(project, null, 2)}\n`, "utf8");
}

export async function saveUploadedAsset(projectId, file) {
  await ensureProjectFolders(projectId);
  const id = newId("asset");
  const originalName = sanitizeFileName(file.name || `${id}.bin`);
  const extension = path.extname(originalName) || extensionFromMime(file.type);
  const fileName = `${id}${extension}`;
  const destination = path.join(uploadsRoot(projectId), fileName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(destination, buffer);

  return {
    id,
    kind: kindFromMime(file.type || ""),
    fileName,
    originalName,
    mimeType: file.type || "application/octet-stream",
    size: buffer.byteLength,
    relativePath: path.relative(projectRoot(projectId), destination).replaceAll(path.sep, "/"),
    createdAt: nowIso()
  };
}

export async function saveBufferedAsset(projectId, asset) {
  await ensureProjectFolders(projectId);
  const id = newId("asset");
  const originalName = sanitizeFileName(asset.name || `${id}.bin`);
  const mimeType = asset.type || "application/octet-stream";
  const extension = path.extname(originalName) || extensionFromMime(mimeType);
  const fileName = `${id}${extension}`;
  const destination = path.join(uploadsRoot(projectId), fileName);
  await fs.writeFile(destination, asset.buffer);

  return {
    id,
    kind: kindFromMime(mimeType),
    fileName,
    originalName,
    mimeType,
    size: asset.buffer.byteLength,
    relativePath: path.relative(projectRoot(projectId), destination).replaceAll(path.sep, "/"),
    createdAt: nowIso()
  };
}

export function resolveAssetPath(projectId, asset) {
  const root = projectRoot(projectId);
  const resolved = path.resolve(root, asset.relativePath);
  if (!resolved.startsWith(path.resolve(root))) throw new Error("Invalid asset path.");
  return resolved;
}

export async function createJob(projectId) {
  await ensureStorage();
  const timestamp = nowIso();
  const job = {
    id: newId("job"),
    projectId,
    status: "queued",
    stage: "Queued",
    progress: 0,
    warnings: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await saveJob(job);
  return job;
}

export async function getJob(jobId) {
  if (hasSupabaseStore()) return getJobFromDb(jobId);

  return JSON.parse(await fs.readFile(jobJsonPath(jobId), "utf8"));
}

export async function saveJob(job) {
  if (hasSupabaseStore()) {
    job.updatedAt = nowIso();
    await saveJobToDb(job);
  }

  await ensureStorage();
  job.updatedAt = nowIso();
  await fs.writeFile(jobJsonPath(job.id), `${JSON.stringify(job, null, 2)}\n`, "utf8");
}

export async function fileSize(filePath) {
  const stat = await fs.stat(filePath);
  return stat.size;
}

function sanitizeFileName(name) {
  return String(name).replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").slice(0, 160);
}

function extensionFromMime(mimeType) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "audio/mpeg") return ".mp3";
  if (mimeType === "audio/wav") return ".wav";
  if (mimeType === "video/mp4") return ".mp4";
  return ".bin";
}

function kindFromMime(mimeType) {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.includes("pdf") || mimeType.includes("document")) return "document";
  return "unknown";
}
