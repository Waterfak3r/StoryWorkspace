import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { planScenePages } from "../comics/plan-pages";
import { readScene, readStyle, readTree } from "../fs";
import type { ImageAdapter } from "./adapter";
import { generateShot } from "./generate-shot";
import { isRenderableComicsFile } from "./image-output";
import { openaiCompatibleImageAdapter } from "./openai-image-adapter";

const LIVE = process.env.SOAK_MISSING === "1";
const PERSIST = process.env.MAGI_PERSIST_PNG === "1";
const AGY_PNG = process.env.AGY_PNG ?? "";
const ONLY_PAGE = process.env.SOAK_PAGE ?? "";
const PROJECT_ID = process.env.SOAK_PROJECT ?? "the-gift-of-the-magi";
const WORKSPACE = path.resolve(".data/projects");
const SCRATCH = process.env.SOAK_SCRATCH ?? "/tmp/grok-goal-a511d7788db4/implementer/magi-missing";
const IMAGE = {
  model: process.env.SOAK_MODEL || "gpt-image-2-only1k2k",
  size: process.env.SOAK_SIZE || "1024x1024",
  quality: process.env.SOAK_QUALITY || "low",
};

const sizedAdapter: ImageAdapter = async (input) =>
  openaiCompatibleImageAdapter({
    ...input,
    provider: {
      ...input.provider,
      model: IMAGE.model,
      size: IMAGE.size,
      quality: IMAGE.quality,
    },
  });

describe.skipIf(!PERSIST || !AGY_PNG)("persist an agy PNG through generateShot", () => {
  it("writes the supplied renderable PNG via the shipped adapter persist path", async () => {
    process.env.STORY_WORKSPACE_ROOT = WORKSPACE;
    delete process.env.STORY_WORKSPACE_DB_PATH;
    const { writeShotImageFile } = await import("./image-output");
    const bytes = readFileSync(AGY_PNG);
    expect(bytes.length).toBeGreaterThan(80);
    const jobs = collectMissingJobs(PROJECT_ID);
    const job = ONLY_PAGE ? jobs.find((item) => item.pageId === ONLY_PAGE) ?? jobs[0] : jobs[0];
    expect(job).toBeTruthy();
    const result = await generateShot(
      PROJECT_ID,
      job!.volumeId,
      job!.chapterId,
      job!.sceneId,
      job!.shotId,
      { mode: "generate" },
      (input) => writeShotImageFile(input, bytes),
    );
    const absolute = path.resolve(WORKSPACE, PROJECT_ID, "outputs", "comics", "current", `${job!.pageId}.png`);
    expect(result.shot.status).toBe("success");
    expect(isRenderableComicsFile(absolute)).toBe(true);
  }, 120_000);
});

describe.skipIf(!LIVE)("generate missing Magi pages only", () => {
  it("generates unusable or missing current pages through generateShot", async () => {
    process.env.STORY_WORKSPACE_ROOT = WORKSPACE;
    delete process.env.STORY_WORKSPACE_DB_PATH;
    mkdirSync(SCRATCH, { recursive: true });
    const jobs = collectMissingJobs(PROJECT_ID);
    const log = [`jobs=${jobs.map((job) => job.pageId).join(",")}`];
    writeFileSync(path.join(SCRATCH, "generate.log"), `${log.join("\n")}\n`);
    expect(jobs.length).toBeGreaterThan(0);

    for (const [index, job] of jobs.entries()) {
      log.push(`CALL ${index + 1}/${jobs.length} ${job.pageId} ${job.sceneId}/${job.shotId}`);
      writeFileSync(path.join(SCRATCH, "generate.log"), `${log.join("\n")}\n`);
      let lastError: unknown;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const result = await generateShot(
            PROJECT_ID,
            job.volumeId,
            job.chapterId,
            job.sceneId,
            job.shotId,
            { mode: "generate", image: IMAGE },
            sizedAdapter,
          );
          const absolute = path.resolve(WORKSPACE, PROJECT_ID, "outputs", "comics", "current", `${job.pageId}.png`);
          const bytes = existsSync(absolute) ? readFileSync(absolute).length : 0;
          log.push(`OK ${job.pageId} status=${result.shot.status} bytes=${bytes}`);
          writeFileSync(path.join(SCRATCH, "generate.log"), `${log.join("\n")}\n`);
          expect(result.shot.status).toBe("success");
          expect(isRenderableComicsFile(absolute)).toBe(true);
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          log.push(`RETRY ${job.pageId} attempt=${attempt} ${error instanceof Error ? error.message : String(error)}`);
          writeFileSync(path.join(SCRATCH, "generate.log"), `${log.join("\n")}\n`);
        }
      }
      if (lastError) {
        throw lastError;
      }
    }
  }, 3_600_000);
});

function collectMissingJobs(projectId: string) {
  const tree = readTree(projectId);
  const layout = readStyle(projectId).layout;
  const jobs: Array<{ volumeId: string; chapterId: string; sceneId: string; shotId: string; pageId: string }> = [];
  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      for (const node of chapter.scenes) {
        const scene = readScene(projectId, volume.id, chapter.id, node.id);
        if (scene.shots.length === 0) {
          continue;
        }
        const planned = planScenePages(scene.id, scene.shots, layout);
        const seen = new Set<string>();
        for (const item of planned) {
          if (seen.has(item.pageId)) {
            continue;
          }
          seen.add(item.pageId);
          if (ONLY_PAGE && item.pageId !== ONLY_PAGE) {
            continue;
          }
          const current = path.resolve(WORKSPACE, projectId, "outputs", "comics", "current", `${item.pageId}.png`);
          if (!ONLY_PAGE && isRenderableComicsFile(current)) {
            continue;
          }
          jobs.push({
            volumeId: volume.id,
            chapterId: chapter.id,
            sceneId: scene.id,
            shotId: item.shotId,
            pageId: item.pageId,
          });
        }
      }
    }
  }
  return jobs;
}
