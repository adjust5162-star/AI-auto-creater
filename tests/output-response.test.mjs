import test from "node:test";
import assert from "node:assert/strict";
import { parseDataUrl, parseRangeHeader } from "../server.mjs";

test("parses HTTP byte ranges for media playback", () => {
  assert.deepEqual(parseRangeHeader("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRangeHeader("bytes=500-", 1000), { start: 500, end: 999 });
  assert.deepEqual(parseRangeHeader("bytes=-200", 1000), { start: 800, end: 999 });
  assert.equal(parseRangeHeader("bytes=1000-1200", 1000), "invalid");
});

test("decodes stored data URLs", () => {
  const parsed = parseDataUrl("data:text/plain;charset=utf-8;base64,7JWI64WV");

  assert.equal(parsed.type, "text/plain;charset=utf-8");
  assert.equal(parsed.buffer.toString("utf8"), "안녕");
});
