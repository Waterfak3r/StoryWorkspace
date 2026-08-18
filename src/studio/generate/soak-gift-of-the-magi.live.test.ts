import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { confirmProjectDialogue } from "../dialogue";
import { directSceneAsync } from "../director";
import { listEntities, readScene, readStyle, readTree, updateEntity } from "../fs";
import { completeEntityReference } from "./complete-reference";
import { generateShot } from "./generate-shot";
import { isRenderableComicsFile } from "./image-output";
import { planScenePages } from "../comics/plan-pages";
import type { ImageAdapter } from "./adapter";
import { openaiCompatibleImageAdapter } from "./openai-image-adapter";

const LIVE = process.env.SOAK_MAGI === "1";
const ONLY_PAGE = process.env.SOAK_PAGE ?? "";
const WORKSPACE = path.resolve(".data/projects");
const SCRATCH = process.env.SOAK_SCRATCH ?? "/tmp/soak-gift-of-the-magi";
const PROJECT_ID = process.env.SOAK_PROJECT ?? "the-gift-of-the-magi";
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

describe.skipIf(!LIVE || process.env.SOAK_RECONFIRM !== "1")("reconfirm Magi dialogue only", () => {
  it("keeps vocatives on the speaker who talks, not the name in the line", async () => {
    process.env.STORY_WORKSPACE_ROOT = WORKSPACE;
    delete process.env.STORY_WORKSPACE_DB_PATH;
    const scenes = await confirmProjectDialogue(PROJECT_ID);
    writeScratch(
      "dialogue.json",
      JSON.stringify(
        scenes.map((scene) => ({
          id: scene.id,
          title: scene.title,
          lines: scene.dialogue.lines.map((line) => ({
            speaker: line.speaker,
            shotId: line.shotId,
            text: line.text,
          })),
        })),
        null,
        2,
      ),
    );
    const scene3 = scenes.find((scene) => scene.id === "scene-03");
    expect(scene3?.dialogue.lines.find((line) => /^Jim, darling/i.test(line.text))?.speaker).toBe("Della");
    expect(scene3?.dialogue.lines.find((line) => /dandy/i.test(line.text))?.speaker).toBe("Della");
    expect(scene3?.dialogue.lines.find((line) => /You’ve cut off your hair/i.test(line.text))?.speaker).toBe("Jim");
  }, 180_000);
});

describe.skipIf(!LIVE || process.env.SOAK_RECONFIRM === "1")("soak Gift of the Magi live comic book", () => {
  it("directs, confirms dialogue, completes key refs, and generates every page", async () => {
    process.env.STORY_WORKSPACE_ROOT = WORKSPACE;
    delete process.env.STORY_WORKSPACE_DB_PATH;
    mkdirSync(SCRATCH, { recursive: true });

    seedSpatialLocks(PROJECT_ID);
    const refSummary = await completeKeyReferences(PROJECT_ID);
    writeScratch("refs.json", JSON.stringify(refSummary, null, 2));

    const tree = readTree(PROJECT_ID);
    const directed: string[] = [];
    for (const volume of tree.volumes) {
      for (const chapter of volume.chapters) {
        for (const sceneNode of chapter.scenes) {
          const scene = await directSceneAsync(PROJECT_ID, volume.id, chapter.id, sceneNode.id);
          directed.push(`${scene.id}:${scene.shots.length}`);
        }
      }
    }

    const confirmed = await confirmProjectDialogue(PROJECT_ID);
    writeScratch(
      "dialogue.json",
      JSON.stringify(
        confirmed.map((scene) => ({
          id: scene.id,
          title: scene.title,
          lines: scene.dialogue.lines.map((line) => ({
            speaker: line.speaker,
            shotId: line.shotId,
            text: line.text.slice(0, 80),
          })),
        })),
        null,
        2,
      ),
    );

    const jobs = collectPageJobs(PROJECT_ID);
    const lines = [
      `project=${PROJECT_ID}`,
      `directed=${directed.join(",")}`,
      `jobs=${jobs.length}`,
      `layout=${readStyle(PROJECT_ID).layout}`,
      `compose=${readStyle(PROJECT_ID).compose}`,
    ];
    writeScratch("generate.log", lines.join("\n"));
    expect(jobs.length).toBeGreaterThan(0);

    const images: string[] = [];
    for (const [index, job] of jobs.entries()) {
      lines.push(`CALL n=${index + 1}/${jobs.length} ${job.sceneId}/${job.shotId} page=${job.pageId}`);
      writeScratch("generate.log", lines.join("\n"));
      const result = await generateWithRetry(PROJECT_ID, job, lines);
      const image = result.shot.selected_image ?? "";
      const absolute = path.resolve(WORKSPACE, PROJECT_ID, ...image.split("/"));
      const bytes = existsSync(absolute) ? readFileSync(absolute).length : 0;
      lines.push(`OK n=${index + 1} status=${result.shot.status} image=${image} bytes=${bytes}`);
      writeScratch("generate.log", lines.join("\n"));
      expect(result.shot.status).toBe("success");
      expect(bytes).toBeGreaterThan(80);
      images.push(absolute);
    }

    writeFileSync(path.join(SCRATCH, "images.txt"), `${images.join("\n")}\n`);
    expect(images.length).toBe(jobs.length);
  }, 3_600_000);
});

async function generateWithRetry(
  projectId: string,
  job: { volumeId: string; chapterId: string; sceneId: string; shotId: string; pageId: string },
  lines: string[],
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await generateShot(
        projectId,
        job.volumeId,
        job.chapterId,
        job.sceneId,
        job.shotId,
        { mode: "generate", image: IMAGE },
        sizedAdapter,
      );
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      lines.push(`RETRY ${job.pageId} attempt=${attempt} ${message}`);
      writeScratch("generate.log", lines.join("\n"));
    }
  }
  throw lastError;
}

function seedSpatialLocks(projectId: string) {
  for (const entity of listEntities(projectId, "location")) {
    const name = entity.name.toLowerCase();
    let spatial = entity.visual.spatial?.trim() ?? "";
    if (!spatial && /flat|room|apartment|home/.test(name)) {
      spatial =
        "shabby $8 furnished flat; shabby couch opposite the door; two windows with a pier glass between them; gray backyard visible through the windows; small table near the entrance door; gas stove to one side; no furniture teleport.";
    }
    if (!spatial && /vestibule|stair|hall/.test(name)) {
      spatial = "ground-floor vestibule below the flat; letter-box and dead electric button; stairs up to the $8 flat.";
    }
    if (!spatial) {
      continue;
    }
    updateEntity(projectId, entity.id, {
      visual: { ...entity.visual, spatial },
      expectedUpdatedAt: entity.updatedAt,
    });
  }
}

async function completeKeyReferences(projectId: string) {
  const wanted = (["character", "location", "prop", "costume"] as const)
    .flatMap((kind) => listEntities(projectId, kind))
    .filter((entity) => {
    if (entity.visual.references.length > 0) {
      return false;
    }
    if (entity.kind === "character" || entity.kind === "location") {
      return true;
    }
    return /watch|comb|chain|hair|fob/i.test(entity.name);
  });
  const done: Array<{ id: string; name: string; path: string; error?: string }> = [];
  for (const entity of wanted) {
    try {
      const result = await completeEntityReference(projectId, entity.id, sizedAdapter);
      done.push({ id: entity.id, name: entity.name, path: result.relativePath });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      done.push({ id: entity.id, name: entity.name, path: "", error: message });
    }
    writeScratch("refs-progress.log", done.map((item) => `${item.name}\t${item.path || item.error || ""}`).join("\n"));
  }
  return done;
}

function collectPageJobs(projectId: string) {
  const tree = readTree(projectId);
  const layout = readStyle(projectId).layout;
  const jobs: Array<{ volumeId: string; chapterId: string; sceneId: string; shotId: string; pageId: string }> = [];
  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      for (const sceneNode of chapter.scenes) {
        const scene = readScene(projectId, volume.id, chapter.id, sceneNode.id);
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

function writeScratch(name: string, text: string) {
  writeFileSync(path.join(SCRATCH, name), `${text}\n`, "utf8");
}
