import test from "node:test";
import assert from "node:assert/strict";
import { buildSourceText, extractReadableText, isAllowedRemoteUrl } from "../lib/source-inputs.mjs";

test("blocks local and private source URLs", () => {
  assert.equal(isAllowedRemoteUrl("http://localhost:3000/video.mp4"), false);
  assert.equal(isAllowedRemoteUrl("http://127.0.0.1/video.mp4"), false);
  assert.equal(isAllowedRemoteUrl("http://192.168.0.2/video.mp4"), false);
  assert.equal(isAllowedRemoteUrl("https://example.com/video.mp4"), true);
});

test("extracts readable text from HTML source", () => {
  const html = `
    <html>
      <head><title>제품 소개 영상</title><meta name="description" content="실제 핵심 기능"></head>
      <body><script>ignore()</script><h1>출시 안내</h1><p>빠르게 이해하는 영상 대본입니다.</p></body>
    </html>
  `;

  const text = extractReadableText(html, "text/html");
  assert.match(text, /제품 소개 영상/);
  assert.match(text, /실제 핵심 기능/);
  assert.match(text, /빠르게 이해하는 영상 대본입니다/);
  assert.doesNotMatch(text, /ignore/);
});

test("builds source text from visual assets when script is empty", () => {
  const sourceText = buildSourceText("", "https://example.com/asset.mp4", [
    { kind: "image", originalName: "cover.png" },
    { kind: "video", originalName: "clip.mp4" }
  ]);

  assert.match(sourceText, /이미지 1개/);
  assert.match(sourceText, /영상 1개/);
  assert.match(sourceText, /완성형 영상/);
});

test("builds source text from URL even when remote extraction is unavailable", () => {
  const sourceText = buildSourceText("", "https://example.com/news/article", []);

  assert.match(sourceText, /참고 URL/);
  assert.ok(sourceText.length >= 20);
});
