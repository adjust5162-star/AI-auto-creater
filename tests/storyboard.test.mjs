import test from "node:test";
import assert from "node:assert/strict";
import { generateStoryboard, getOpenRouterApiKey, retimeScenes } from "../lib/storyboard.mjs";

test("generates local storyboard without OpenRouter", async () => {
  const oldKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  const result = await generateStoryboard({
    title: "AI 영상 자동화",
    contentType: "educational",
    aspectRatio: "vertical",
    targetDuration: 45,
    sourceText:
      "생성형 AI는 영상 제작을 빠르게 바꾸고 있습니다. 시스템은 원문을 분석하고 장면을 나눕니다. 이후 자막과 영상을 만들어 결과물을 제공합니다.",
    sourceUrl: "",
    voice: "clear-ko",
    subtitlePreset: "bold-bottom",
    backgroundMusic: "none",
    brandColor: "#146ef5"
  });
  if (oldKey) process.env.OPENROUTER_API_KEY = oldKey;

  assert.equal(result.aiProvider, "local");
  assert.ok(result.scenes.length >= 3);
  assert.equal(result.scenes[0].start, 0);
});

test("retimes scenes continuously", () => {
  const result = retimeScenes([
    { id: "b", index: 2, duration: 5, start: 10, end: 15 },
    { id: "a", index: 1, duration: 4, start: 99, end: 100 }
  ]);

  assert.equal(result[0].index, 1);
  assert.equal(result[0].start, 0);
  assert.equal(result[0].end, 4);
  assert.equal(result[1].start, 4);
  assert.equal(result[1].end, 9);
});

test("strips invisible characters from OpenRouter API key", () => {
  const oldKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "\uFEFFsk-test\u200B\n";

  assert.equal(getOpenRouterApiKey(), "sk-test");

  if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = oldKey;
});

test("does not preserve broken placeholders in local storyboard", async () => {
  const oldKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;

  const result = await generateStoryboard({
    title: "OpenRouter API",
    contentType: "educational",
    aspectRatio: "landscape",
    targetDuration: 15,
    sourceText: "OpenRouter API ?? ????? ??????. ?? ????",
    sourceUrl: "",
    voice: "clear-ko",
    subtitlePreset: "bold-bottom",
    backgroundMusic: "none",
    brandColor: "#146ef5"
  });

  const text = result.scenes.map((scene) => `${scene.headline} ${scene.narration}`).join(" ");
  assert.doesNotMatch(text, /\?{2,}/);
  assert.match(text, /OpenRouter API/);

  if (oldKey) process.env.OPENROUTER_API_KEY = oldKey;
});
