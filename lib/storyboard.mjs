import { randomUUID } from "node:crypto";

export async function generateStoryboard(input) {
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const scenes = await generateWithOpenRouter(input);
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

  if (process.env.OPENROUTER_API_KEY) {
    try {
      const generated = await generateSingleSceneWithOpenRouter(project, scene);
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

async function generateWithOpenRouter(input) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_PUBLIC_URL || "http://localhost:3000",
      "X-Title": "AI Video Automation App"
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a Korean video producer. Return compact JSON only for editable FFmpeg-rendered video scenes."
        },
        {
          role: "user",
          content: [
            `Title: ${input.title}`,
            `Content type: ${input.contentType}`,
            `Aspect ratio: ${input.aspectRatio}`,
            `Target duration seconds: ${input.targetDuration}`,
            `Source URL: ${input.sourceUrl || "none"}`,
            "Return JSON: {\"scenes\":[{\"headline\":\"...\",\"narration\":\"...\",\"highlightedWords\":[\"...\"]}]}",
            "Use Korean unless the source is clearly another language.",
            input.sourceText
          ].join("\n")
        }
      ],
      temperature: 0.7
    })
  });

  if (!response.ok) throw new Error(`OpenRouter request failed with HTTP ${response.status}.`);
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned an empty response.");
  const parsed = parseJsonObject(content);
  if (!Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
    throw new Error("OpenRouter response did not include scenes.");
  }
  return parsed.scenes.slice(0, 12);
}

async function generateSingleSceneWithOpenRouter(project, scene) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_PUBLIC_URL || "http://localhost:3000",
      "X-Title": "AI Video Automation App"
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
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
    })
  });

  if (!response.ok) throw new Error(`OpenRouter request failed with HTTP ${response.status}.`);
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned an empty response.");
  return parseJsonObject(content);
}

function generateLocally(input) {
  const sentences = splitSentences(input.sourceText);
  const sceneCount = Math.min(10, Math.max(3, Math.ceil(input.targetDuration / 18)));
  const groups = chunkEvenly(sentences, sceneCount);
  return normalizeScenes(
    groups.map((group, index) => {
      const narration = group.join(" ").trim() || input.sourceText.slice(0, 180);
      return {
        narration,
        headline: makeHeadline(narration, input.title, index),
        highlightedWords: extractKeywords(narration)
      };
    }),
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
  if (text.startsWith("{")) return JSON.parse(text);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("OpenRouter response was not JSON.");
  return JSON.parse(match[0]);
}

function splitSentences(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  const split = normalized.split(/(?<=[.!?。！？]|다\.|요\.|니다\.)\s+/u).filter(Boolean);
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
  const stopwords = new Set(["그리고", "하지만", "있는", "없는", "합니다", "this", "that", "with"]);
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
    headline: scene.headline.endsWith("?") ? scene.headline : `${scene.headline}?`,
    narration: cleanText(scene.narration, 260),
    highlightedWords: extractKeywords(scene.narration)
  };
}

function cleanText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3).trim()}...`;
}
