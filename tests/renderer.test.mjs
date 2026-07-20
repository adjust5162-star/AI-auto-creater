import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { renderProject } from "../lib/renderer.mjs";
import { createJob, ensureProjectFolders, getJob, outputRoot, saveProject } from "../lib/storage.mjs";

test("renders a visible MP4 when no visual asset is provided", async () => {
  const projectId = `proj_renderer_test_${Date.now()}`;
  await ensureProjectFolders(projectId);
  const project = {
    id: projectId,
    title: "Renderer Smoke Test",
    contentType: "educational",
    aspectRatio: "vertical",
    targetDuration: 3,
    sourceText: "Render a complete vertical MP4 with a moving background and lower subtitle.",
    sourceUrl: "",
    voice: "clear-ko",
    subtitlePreset: "bold-bottom",
    backgroundMusic: "none",
    brandColor: "#216ce7",
    status: "draft",
    aiProvider: "local",
    assets: [],
    scenes: [
      {
        id: "scene_renderer_smoke",
        index: 1,
        headline: "Renderer Smoke Test",
        narration: "A moving background and lower subtitle should be burned into the video.",
        start: 0,
        end: 3,
        duration: 3,
        transition: "cut",
        cameraMovement: "slow-zoom",
        highlightedWords: ["moving", "subtitle"]
      }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await saveProject(project);
  const job = await createJob(project.id);

  await renderProject(project, job.id);

  const completedJob = await getJob(job.id);
  const outputPath = path.join(outputRoot(project.id, job.id), "final.mp4");
  const stat = await fs.stat(outputPath);
  assert.equal(completedJob.status, "completed");
  assert.equal(completedJob.warnings.length, 0);
  assert.ok(stat.size > 10_000);
});
