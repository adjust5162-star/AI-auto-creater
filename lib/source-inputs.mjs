import path from "node:path";
import { saveBufferedAsset } from "./storage.mjs";

export const remoteAssetLimit = 50 * 1024 * 1024;
export const remoteTextLimit = 1 * 1024 * 1024;

export async function importSourceUrl(projectId, sourceUrl) {
  const url = normalizeRemoteUrl(sourceUrl);
  if (!url) return { assets: [], text: "", warnings: [] };
  if (!isAllowedRemoteUrl(url)) {
    return {
      assets: [],
      text: "",
      warnings: ["내부 네트워크 또는 로컬 주소는 보안을 위해 가져오지 않았습니다."]
    };
  }

  try {
    const response = await fetchWithTimeout(url.href);
    if (!response.ok) {
      return { assets: [], text: "", warnings: [`URL을 가져오지 못했습니다. HTTP ${response.status}`] };
    }

    const type = normalizeContentType(response.headers.get("content-type"));
    if (type.startsWith("image/") || type.startsWith("video/") || type.startsWith("audio/")) {
      const buffer = await readResponseBuffer(response, remoteAssetLimit);
      const asset = await saveBufferedAsset(projectId, {
        name: fileNameFromUrl(url, type),
        type,
        buffer
      });
      return {
        assets: [asset],
        text: describeRemoteMedia(url, asset),
        warnings: []
      };
    }

    if (isTextLike(type)) {
      const buffer = await readResponseBuffer(response, remoteTextLimit);
      const rawText = buffer.toString("utf8");
      return {
        assets: [],
        text: extractReadableText(rawText, type),
        warnings: []
      };
    }

    return {
      assets: [],
      text: "",
      warnings: [`지원하지 않는 URL 형식입니다: ${type || "unknown"}`]
    };
  } catch (error) {
    return {
      assets: [],
      text: "",
      warnings: [`URL 소스를 가져오지 못했습니다: ${error instanceof Error ? error.message : "unknown error"}`]
    };
  }
}

export function buildSourceText(rawText, sourceUrl, assets) {
  const provided = cleanText(rawText, 18_000);
  if (provided.length >= 20) return provided;

  const visualAssets = assets.filter((asset) => asset.kind === "image" || asset.kind === "video");
  const audioAssets = assets.filter((asset) => asset.kind === "audio");
  const parts = [];
  if (provided) parts.push(provided);
  if (visualAssets.length) {
    parts.push(
      `제공된 ${assetKindSummary(visualAssets)} 자료를 기반으로 완성형 영상을 제작합니다. 각 장면에는 업로드된 시각 자료를 배경으로 사용하고, 핵심 메시지를 자막으로 정리합니다.`
    );
  }
  if (audioAssets.length) {
    parts.push("업로드된 오디오를 최종 영상의 배경음 또는 음성 트랙으로 사용합니다.");
  }
  if (sourceUrl) {
    parts.push(`참고 URL: ${sourceUrl}`);
  }
  if (!parts.length) return "";
  return cleanText(parts.join(" "), 18_000);
}

export function extractReadableText(rawText, contentType = "text/plain") {
  const text = String(rawText || "");
  if (contentType.includes("html")) return extractHtmlText(text);
  return cleanText(text.replace(/[{}[\]"<>]/g, " "), 18_000);
}

export function isAllowedRemoteUrl(url) {
  const parsed = normalizeRemoteUrl(url);
  if (!parsed || !["http:", "https:"].includes(parsed.protocol)) return false;
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host === "0.0.0.0" || host === "::1") return false;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return false;
  const private172 = host.match(/^172\.(\d{1,2})\./);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
  if (/^169\.254\./.test(host)) return false;
  return true;
}

function normalizeRemoteUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "AI-auto-creater/1.0"
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readResponseBuffer(response, limit) {
  const length = Number(response.headers.get("content-length") || 0);
  if (length > limit) throw new Error(`파일이 너무 큽니다. 최대 ${Math.round(limit / 1024 / 1024)}MB까지 지원합니다.`);

  const reader = response.body?.getReader();
  if (!reader) return Buffer.from(await response.arrayBuffer());

  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) throw new Error(`파일이 너무 큽니다. 최대 ${Math.round(limit / 1024 / 1024)}MB까지 지원합니다.`);
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function normalizeContentType(value) {
  return String(value || "application/octet-stream").split(";")[0].trim().toLowerCase();
}

function isTextLike(type) {
  return type.startsWith("text/") || type === "application/json" || type === "application/xml" || type === "application/rss+xml";
}

function fileNameFromUrl(url, type) {
  const current = path.basename(decodeURIComponent(url.pathname || "")) || "remote-asset";
  if (path.extname(current)) return current.slice(0, 160);
  return `${current}${extensionFromType(type)}`.slice(0, 160);
}

function extensionFromType(type) {
  if (type === "image/png") return ".png";
  if (type === "image/jpeg") return ".jpg";
  if (type === "image/webp") return ".webp";
  if (type === "video/mp4") return ".mp4";
  if (type === "video/webm") return ".webm";
  if (type === "audio/mpeg") return ".mp3";
  if (type === "audio/wav") return ".wav";
  return ".bin";
}

function describeRemoteMedia(url, asset) {
  const kind = asset.kind === "video" ? "영상" : asset.kind === "image" ? "이미지" : "오디오";
  if (asset.kind === "audio") return `제공된 오디오 URL ${url.href}를 최종 영상의 사운드 소스로 사용합니다.`;
  return `제공된 ${kind} URL ${url.href}를 장면의 시각 자료로 사용하여 완성형 영상을 제작합니다.`;
}

function extractHtmlText(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  const description =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    "";
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|h1|h2|h3|li|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return cleanText([title, description, body].filter(Boolean).join("\n"), 18_000);
}

function assetKindSummary(assets) {
  const imageCount = assets.filter((asset) => asset.kind === "image").length;
  const videoCount = assets.filter((asset) => asset.kind === "video").length;
  const parts = [];
  if (imageCount) parts.push(`이미지 ${imageCount}개`);
  if (videoCount) parts.push(`영상 ${videoCount}개`);
  return parts.join(", ");
}

function cleanText(value, maxLength) {
  return decodeEntities(String(value || ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function decodeEntities(value) {
  return String(value)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
