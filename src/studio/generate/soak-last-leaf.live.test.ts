import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { planScenePages } from "../comics/plan-pages";
import { confirmProjectDialogue } from "../dialogue";
import { directSceneAsync } from "../director";
import { readScene, readStyle, readTree } from "../fs";
import { selectComicsLettering } from "../style";
import { ingestFixtureStory } from "../test-support/fixture-stories";
import { generateShot } from "./generate-shot";

const LIVE = process.env.SOAK_LIVE === "1";
const WORKSPACE = path.resolve(".data/projects");
const SCRATCH = process.env.SOAK_SCRATCH ?? "/tmp/soak-last-leaf";
const BUDGET = Math.min(25, Math.max(1, Number.parseInt(process.env.SOAK_BUDGET ?? "25", 10) || 25));
const PROJECT_TITLE = "The Last Leaf";

describe.skipIf(!LIVE)("soak last-leaf live comic pages", () => {
  it("directs, confirms original-script dialogue, and generates up to the budget", async () => {
    process.env.STORY_WORKSPACE_ROOT = WORKSPACE;
    delete process.env.STORY_WORKSPACE_DB_PATH;
    mkdirSync(SCRATCH, { recursive: true });

    const projectId = await ensureIngested();
    selectComicsLettering(projectId, "model");

    const tree = readTree(projectId);
    const directed: string[] = [];
    for (const volume of tree.volumes) {
      for (const chapter of volume.chapters) {
        for (const sceneNode of chapter.scenes) {
          const scene = await directSceneAsync(projectId, volume.id, chapter.id, sceneNode.id);
          directed.push(`${scene.id}:${scene.shots.length}`);
        }
      }
    }

    const confirmed = await confirmProjectDialogue(projectId);
    const lineSummary = confirmed.map((scene) => ({
      id: scene.id,
      title: scene.title,
      status: scene.dialogue.status,
      lines: scene.dialogue.lines.map((line) => ({
        kind: line.kind,
        speaker: line.speaker,
        shotId: line.shotId,
        text: line.text.slice(0, 80),
      })),
    }));
    writeFileSync(path.join(SCRATCH, "dialogue.json"), `${JSON.stringify(lineSummary, null, 2)}\n`);

    const jobs = collectPageJobs(projectId);
    const lines = [`project=${projectId}`, `directed=${directed.join(",")}`, `jobs=${jobs.length}`, `budget=${BUDGET}`];
    writeScratch("generate.log", lines.join("\n"));
    expect(jobs.length).toBeGreaterThan(0);

    const images: string[] = [];
    for (const job of jobs) {
      const count = bumpCount();
      if (count > BUDGET) {
        lines.push(`STOP budget at ${job.sceneId}/${job.shotId} count=${count}`);
        break;
      }
      lines.push(`CALL n=${count} ${job.sceneId}/${job.shotId}`);
      writeScratch("generate.log", lines.join("\n"));
      const result = await generateShot(projectId, job.volumeId, job.chapterId, job.sceneId, job.shotId, {
        mode: "generate",
        image: {
          model: process.env.SOAK_MODEL || "gpt-image-2-only1k2k",
          size: "1024x1024",
          quality: "low",
        },
      });
      const image = result.shot.selected_image ?? "";
      const absolute = path.resolve(WORKSPACE, projectId, ...image.split("/"));
      const bytes = existsSync(absolute) ? readFileSync(absolute) : Buffer.alloc(0);
      const fake = bytes.length <= 80;
      lines.push(
        `OK n=${count} status=${result.shot.status} image=${image} bytes=${bytes.length} fake1x1=${fake}`,
      );
      writeScratch("generate.log", lines.join("\n"));
      expect(result.shot.status).toBe("success");
      expect(fake).toBe(false);
      images.push(absolute);
    }

    writeFileSync(path.join(SCRATCH, "images.txt"), `${images.join("\n")}\n`);
    expect(images.length).toBeGreaterThan(0);
  }, 3_600_000);

  it.skipIf(process.env.SOAK_RECONFIRM !== "1")("reconfirms dialogue from original scripts", async () => {
    process.env.STORY_WORKSPACE_ROOT = WORKSPACE;
    delete process.env.STORY_WORKSPACE_DB_PATH;
    const scenes = await confirmProjectDialogue("the-last-leaf");
    const summary = scenes.map((scene) => ({
      title: scene.title,
      lines: scene.dialogue.lines.map((line) => `${line.speaker}:${line.text}`),
    }));
    writeScratch("dialogue-reconfirm.json", `${JSON.stringify(summary, null, 2)}\n`);
    const ivy = scenes.find((scene) => scene.title.includes("ivy"));
    expect(ivy?.dialogue.lines.some((line) => /twelve/i.test(line.text))).toBe(true);
    expect(ivy?.dialogue.lines.filter((line) => /twelve|eleven|ten|nine|seven/i.test(line.text)).length).toBeGreaterThanOrEqual(4);
  }, 600_000);

  it.skipIf(process.env.SOAK_IVY !== "1")("regenerates the ivy counting pages", async () => {
    process.env.STORY_WORKSPACE_ROOT = WORKSPACE;
    delete process.env.STORY_WORKSPACE_DB_PATH;
    mkdirSync(SCRATCH, { recursive: true });
    const projectId = "the-last-leaf";
    const jobs = [
      { volumeId: "volume-01", chapterId: "chapter-02", sceneId: "scene-01", shotId: "shot-01" },
      { volumeId: "volume-01", chapterId: "chapter-02", sceneId: "scene-01", shotId: "shot-03" },
    ];
    const lines: string[] = ["ivy regen start"];
    for (const job of jobs) {
      const count = bumpCount();
      if (count > BUDGET) {
        break;
      }
      const result = await generateShot(projectId, job.volumeId, job.chapterId, job.sceneId, job.shotId, {
        mode: "regenerate",
        image: {
          model: process.env.SOAK_MODEL || "gpt-image-2-only1k2k",
          size: "1024x1024",
          quality: "low",
        },
      });
      const image = result.shot.selected_image ?? "";
      const absolute = path.resolve(WORKSPACE, projectId, ...image.split("/"));
      const bytes = existsSync(absolute) ? readFileSync(absolute).length : 0;
      lines.push(`IVY n=${count} ${job.shotId} ${image} bytes=${bytes} status=${result.shot.status}`);
      writeScratch("ivy-regen.log", lines.join("\n"));
      expect(result.shot.status).toBe("success");
      expect(bytes).toBeGreaterThan(80);
    }
  }, 900_000);

  it.skipIf(process.env.SOAK_REGEN !== "1")("regenerates the empty-balloon and invented-caption pages", async () => {
    process.env.STORY_WORKSPACE_ROOT = WORKSPACE;
    delete process.env.STORY_WORKSPACE_DB_PATH;
    mkdirSync(SCRATCH, { recursive: true });
    const projectId = "the-last-leaf";
    const jobs = [
      { volumeId: "volume-01", chapterId: "chapter-01", sceneId: "scene-02", shotId: "shot-01" },
      { volumeId: "volume-01", chapterId: "chapter-01", sceneId: "scene-03", shotId: "shot-05" },
    ];
    const lines: string[] = ["regen start"];
    for (const job of jobs) {
      const count = bumpCount();
      if (count > BUDGET) {
        break;
      }
      const result = await generateShot(projectId, job.volumeId, job.chapterId, job.sceneId, job.shotId, {
        mode: "regenerate",
        image: {
          model: process.env.SOAK_MODEL || "gpt-image-2-only1k2k",
          size: "1024x1024",
          quality: "low",
        },
      });
      const image = result.shot.selected_image ?? "";
      const absolute = path.resolve(WORKSPACE, projectId, ...image.split("/"));
      const bytes = existsSync(absolute) ? readFileSync(absolute).length : 0;
      lines.push(`REGEN n=${count} ${job.sceneId}/${job.shotId} ${image} bytes=${bytes} status=${result.shot.status}`);
      writeScratch("regen.log", lines.join("\n"));
      expect(result.shot.status).toBe("success");
      expect(bytes).toBeGreaterThan(80);
    }
  }, 900_000);
});

async function ensureIngested(): Promise<string> {
  const existing = path.join(WORKSPACE, "the-last-leaf", "project.json");
  if (existsSync(existing)) {
    return "the-last-leaf";
  }
  const { project } = await ingestFixtureStory(PROJECT_TITLE, "last-leaf");
  return project.id;
}

function collectPageJobs(projectId: string) {
  const tree = readTree(projectId);
  const jobs: Array<{ volumeId: string; chapterId: string; sceneId: string; shotId: string }> = [];
  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      for (const sceneNode of chapter.scenes) {
        const scene = readScene(projectId, volume.id, chapter.id, sceneNode.id);
        if (!scene.script.trim() || scene.shots.length === 0) {
          continue;
        }
        const planned = planScenePages(scene.id, scene.shots, readStyle(projectId).layout);
        const seen = new Set<string>();
        for (const item of planned) {
          if (seen.has(item.pageId)) {
            continue;
          }
          seen.add(item.pageId);
          jobs.push({ volumeId: volume.id, chapterId: chapter.id, sceneId: scene.id, shotId: item.shotId });
        }
      }
    }
  }
  return jobs;
}

function bumpCount(): number {
  const file = path.join(SCRATCH, "image-gen-count.txt");
  const current = existsSync(file) ? Number.parseInt(readFileSync(file, "utf8").trim() || "0", 10) : 0;
  const next = current + 1;
  writeFileSync(file, String(next), "utf8");
  return next;
}

function writeScratch(name: string, text: string) {
  writeFileSync(path.join(SCRATCH, name), `${text}\n`, "utf8");
}
