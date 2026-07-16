import test from "node:test";
import assert from "node:assert/strict";
import { formatSrtTime, scenesToSrt, scenesToVtt } from "../lib/subtitles.mjs";

test("formats SRT time", () => {
  assert.equal(formatSrtTime(65.432), "00:01:05,432");
});

test("builds SRT and VTT tracks", () => {
  const scenes = [
    {
      index: 1,
      narration: "첫 번째 내레이션입니다.",
      start: 0,
      end: 3,
      duration: 3
    }
  ];
  assert.match(scenesToSrt(scenes), /1\n00:00:00,000 --> 00:00:03,000/);
  assert.match(scenesToVtt(scenes), /WEBVTT/);
  assert.match(scenesToVtt(scenes), /00:00:00.000 --> 00:00:03.000/);
});
