import { randomUUID } from "node:crypto";

export async function generateStoryboard(input) {
  const openRouterApiKey = getOpenRouterApiKey();
  if (openRouterApiKey) {
    try {
      const scenes = await generateWithOpenRouter(input, openRouterApiKey);
      return {
        scenes: normalizeScenes(scenes, input.targetDuration),
        aiProvider: "openrouter"
      };
    } catch (error) {
      return {
        scenes: generateLocally(input),
        aiProvider: "local",
        aiWarning: error instanceof Error ? error.message : "OpenRouter generation failed."
      };
    }
  }

  return {
    scenes: generateLocally(input),
    aiProvider: "local",
    aiWarning: "OPENROUTER_API_KEY is not configured, so a local storyboard was generated."
  };
}

export async function regenerateScene(project, sceneId) {
  const scene = project.scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error("Scene not found.");

  const openRouterApiKey = getOpenRouterApiKey();
  if (openRouterApiKey) {
    try {
      const generated = await generateSingleSceneWithOpenRouter(project, scene, openRouterApiKey);
      return {
        ...scene,
        headline: cleanText(generated.headline, 120),
        narration: cleanText(generated.narration, 1200),
        highlightedWords: Array.isArray(generated.highlightedWords)
          ? generated.highlightedWords.map(String).slice(0, 8)
          : scene.highlightedWords
      };
    } catch {
      return localSceneVariant(scene);
    }
  }

  return localSceneVariant(scene);
}

export function retimeScenes(scenes) {
  let start = 0;
  return [...scenes]
    .sort((a, b) => a.index - b.index)
    .map((scene, index) => {
      const duration = Math.max(3, Math.min(45, Number(scene.duration) || 3));
      const next = {
        ...scene,
        index: index + 1,
        duration,
        start,
        end: start + duration
      };
      start = next.end;
      return next;
    });
}

export function getOpenRouterApiKey() {
  return cleanHeaderToken(process.env.OPENROUTER_API_KEY || "");
}

async function generateWithOpenRouter(input, apiKey) {
  const payload = await requestOpenRouter(apiKey, {
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You are a Korean video producer. Return compact JSON only for editable FFmpeg-rendered video scenes."
      },
      {
        role: "user",
        content: [
          `Title: ${input.title}`,
          `Content type: ${input.contentType}`,
          `Aspect ratio: ${input.aspectRatio}`,
          `Target duration seconds: ${input.targetDuration}`,
          `Source URL: ${input.sourceUrl || "none"}`,
          "Return exactly one JSON object. The top-level key must be scenes.",
          "Required shape: {\"scenes\":[{\"headline\":\"...\",\"narration\":\"...\",\"highlightedWords\":[\"...\"]}]}",
          "Use Korean unless the source is clearly another language.",
          input.sourceText
        ].join("\n")
      }
    ],
    temperature: 0.7
  });
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned an empty response.");
  const parsed = parseJsonObject(content);
  const scenes = extractSceneList(parsed);
  if (scenes.length === 0) {
    throw new Error("OpenRouter response did not include scenes.");
  }
  return scenes.slice(0, 12);
}

async function generateSingleSceneWithOpenRouter(project, scene, apiKey) {
  const payload = await requestOpenRouter(apiKey, {
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Return JSON only for one improved video scene." },
      {
        role: "user",
        content: JSON.stringify({
          projectTitle: project.title,
          sourceText: project.sourceText.slice(0, 4000),
          currentScene: scene,
          returnShape: { headline: "string", narration: "string", highlightedWords: ["string"] }
        })
      }
    ],
    temperature: 0.8
  });
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned an empty response.");
  return parseJsonObject(content);
}

async function requestOpenRouter(apiKey, requestBody) {
  let lastError;
  for (const model of getOpenRouterModels()) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.APP_PUBLIC_URL || "http://localhost:3000",
        "X-Title": "AI Video Automation App"
      },
      body: JSON.stringify({ model, ...requestBody })
    });
    if (response.ok) return response.json();
    const body = await response.text().catch(() => "");
    const message = extractOpenRouterError(body);
    lastError = new Error(`OpenRouter model ${model} failed with HTTP ${response.status}${message ? `: ${message}` : "."}`);
  }
  throw lastError || new Error("OpenRouter request failed.");
}

function getOpenRouterModels() {
  return String(process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini")
    .replace(/[\uFEFF\u200B-\u200D\u2060]/g, "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
}

function cleanHeaderToken(value) {
  return String(value || "")
    .replace(/[\uFEFF\u200B-\u200D\u2060]/g, "")
    .replace(/[^\x21-\x7E]/g, "")
    .trim();
}

function extractOpenRouterError(body) {
  try {
    const parsed = JSON.parse(body);
    return cleanText(parsed?.error?.metadata?.raw || parsed?.error?.message || "", 180);
  } catch {
    return cleanText(body, 180);
  }
}

function generateLocally(input) {
  const source = cleanBrokenText(input.sourceText);
  if (!source) {
    return generateFallbackScenes(input);
  }

  const sentences = splitSentences(source);
  const sceneCount = Math.min(10, Math.max(3, Math.ceil(input.targetDuration / 18)));
  const groups = chunkEvenly(sentences, sceneCount);
  return normalizeScenes(
    groups.map((group, index) => {
      const narration = group.join(" ").trim() || source.slice(0, 180);
      return {
        narration,
        headline: makeHeadline(narration, input.title, index),
        highlightedWords: extractKeywords(narration)
      };
    }),
    input.targetDuration
  );
}

function generateFallbackScenes(input) {
  const title = cleanBrokenText(input.title) || "AI 영상";
  const sourceHint = cleanBrokenText(input.sourceText);
  const focus = sourceHint && sourceHint !== title ? sourceHint.slice(0, 80) : title;
  return normalizeScenes(
    [
      {
        headline: `${title} 핵심 정리`,
        narration: `${focus}의 핵심 메시지를 시청자가 바로 이해할 수 있도록 짧고 선명하게 정리합니다.`,
        highlightedWords: extractKeywords(`${title} 핵심 메시지`)
      },
      {
        headline: "장면 흐름 구성",
        narration: "도입, 전개, 결론으로 이어지는 흐름을 만들고 자막과 내레이션을 자연스럽게 연결합니다.",
        highlightedWords: ["장면", "자막", "내레이션"]
      },
      {
        headline: "완성 영상 점검",
        narration: "최종 MP4 재생, 자막 표시, 화면 구성을 확인할 수 있는 결과물을 준비합니다.",
        highlightedWords: ["MP4", "재생", "완성"]
      }
    ],
    input.targetDuration
  );
}

function normalizeScenes(items, targetDuration) {
  const maxScenes = Math.max(1, Math.min(12, Math.floor(targetDuration / 4)));
  const scenes = items.slice(0, maxScenes);
  const duration = Math.max(3, Math.round(targetDuration / Math.max(1, scenes.length)));
  let start = 0;
  return scenes.map((item, index) => {
    const isLast = index === scenes.length - 1;
    const end = isLast ? targetDuration : Math.min(targetDuration, start + duration);
    const sceneDuration = Math.max(3, end - start);
    const scene = {
      id: `scene_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      index: index + 1,
      narration: cleanText(item.narration, 1200),
      headline: cleanText(item.headline, 120),
      start,
      end: start + sceneDuration,
      duration: sceneDuration,
      assetId: undefined,
      transition: index === 0 ? "cut" : "fade",
      cameraMovement: index % 3 === 0 ? "slow-zoom" : index % 3 === 1 ? "pan-left" : "pan-right",
      highlightedWords: Array.isArray(item.highlightedWords)
        ? item.highlightedWords.map(String).slice(0, 8)
        : extractKeywords(item.narration)
    };
    start = scene.end;
    return scene;
  });
}

function parseJsonObject(content) {
  const text = String(content).trim();
  try {
    return JSON.parse(text);
  } catch {
    const objectText = extractFirstJsonObject(text);
    if (!objectText) throw new Error("OpenRouter response was not JSON.");
    return JSON.parse(objectText);
  }
}

function extractFirstJsonObject(text) {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) return text.slice(start, index + 1);
    }
  }
  return "";
}

function extractSceneList(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.scenes)) return parsed.scenes;
  if (Array.isArray(parsed?.storyboard)) return parsed.storyboard;
  if (Array.isArray(parsed?.video?.scenes)) return parsed.video.scenes;
  if (typeof parsed?.headline === "string" || typeof parsed?.narration === "string") return [parsed];
  return [];
}

function splitSentences(text) {
  const normalized = cleanBrokenText(text);
  const split = normalized.split(/(?<=[.!?。！？])\s+/u).filter(Boolean);
  if (split.length > 1) return split;
  return normalized.match(/.{1,120}(?:\s|$)/g)?.map((part) => part.trim()).filter(Boolean) || [normalized];
}

function chunkEvenly(items, count) {
  const groups = Array.from({ length: count }, () => []);
  items.forEach((item, index) => groups[index % count].push(item));
  return groups.filter((group) => group.length > 0);
}

function makeHeadline(text, title, index) {
  const words = text.replace(/[^\p{L}\p{N}\s]/gu, "").split(/\s+/).filter(Boolean);
  const base = words.slice(0, 7).join(" ") || title;
  const prefix = index === 0 ? "핵심" : index === 1 ? "전개" : "포인트";
  return `${prefix}: ${base}`.slice(0, 78);
}

function extractKeywords(text) {
  const stopwords = new Set(["그리고", "하지만", "있는", "없는", "합니다", "입니다", "this", "that", "with"]);
  return Array.from(
    new Set(
      String(text)
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((word) => word.length >= 2 && !stopwords.has(word.toLowerCase()))
    )
  ).slice(0, 8);
}

function localSceneVariant(scene) {
  return {
    ...scene,
    headline: cleanText(`개선: ${scene.headline}`, 120),
    narration: cleanText(scene.narration, 260),
    highlightedWords: extractKeywords(scene.narration)
  };
}

function cleanText(value, maxLength) {
  const text = cleanBrokenText(value);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3).trim()}...`;
}

function cleanBrokenText(value) {
  const text = String(value || "")
    .replace(/[\uFEFF\u200B-\u200D\u2060]/g, "")
    .replace(/\uFFFD/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!/\?{2,}/.test(text)) return text;
  return (text.match(/[A-Za-z0-9][A-Za-z0-9 .:/+#_-]*/g) || []).join(" ").replace(/\s+/g, " ").trim();
}
