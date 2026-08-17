import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { readScene, readTree } from "../fs";
import { generateShot } from "./generate-shot";

const LIVE = process.env.LAST_LEAF_LIVE === "1";
const PROJECT_ID = "the-last-leaf";
const SCRATCH = process.env.LAST_LEAF_SCRATCH ?? "";
const BUDGET = 50;

describe.skipIf(!LIVE)("last-leaf live comic pages", () => {
  it("generates one shipped page image for each remaining page group", async () => {
    process.env.STORY_WORKSPACE_ROOT = path.resolve(".data/projects");
    delete process.env.STORY_WORKSPACE_DB_PATH;

    const tree = readTree(PROJECT_ID);
    const jobs: Array<{ volumeId: string; chapterId: string; sceneId: string; shotId: string }> = [];
    for (const volume of tree.volumes) {
      for (const chapter of volume.chapters) {
        for (const sceneNode of chapter.scenes) {
          const scene = readScene(PROJECT_ID, volume.id, chapter.id, sceneNode.id);
          if (!scene.script.trim()) {
            continue;
          }
          const step = 2;
          for (let index = 0; index < scene.shots.length; index += step) {
            const lead = scene.shots[index];
            if (!lead) {
              continue;
            }
            const group = scene.shots.slice(index, index + step);
            if (group.every((shot) => shot.selected_image && shot.selected_image.startsWith("outputs/comics/pages/"))) {
              continue;
            }
            jobs.push({ volumeId: volume.id, chapterId: chapter.id, sceneId: scene.id, shotId: lead.id });
          }
        }
      }
    }

    expect(jobs.length).toBeGreaterThan(0);
    const lines: string[] = [`jobs=${jobs.length}`];

    for (const job of jobs) {
      const count = bumpCount();
      if (count > BUDGET) {
        lines.push(`STOP budget at ${job.sceneId}/${job.shotId} count=${count}`);
        break;
      }
      lines.push(`CALL n=${count} ${job.sceneId}/${job.shotId}`);
      try {
        const result = await generateShot(PROJECT_ID, job.volumeId, job.chapterId, job.sceneId, job.shotId, {
          mode: "generate",
          pageSize: 2,
          image: {
            model: process.env.LAST_LEAF_MODEL || "gpt-image-2-only1k2k",
            size: "1024x1024",
            quality: "low",
          },
        });
        const image = result.shot.selected_image ?? "";
        const absolute = path.resolve(".data/projects", PROJECT_ID, ...image.split("/"));
        const bytes = existsSync(absolute) ? readFileSync(absolute) : Buffer.alloc(0);
        const fake = bytes.length <= 80;
        lines.push(
          `OK n=${count} status=${result.shot.status} image=${image} bytes=${bytes.length} fake1x1=${fake}`,
        );
        expect(result.shot.status).toBe("success");
        expect(image.startsWith("outputs/comics/pages/")).toBe(true);
        expect(fake).toBe(false);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lines.push(`ERR n=${count} ${job.sceneId}/${job.shotId} ${message}`);
        writeScratch("generate.log", lines.join("\n"));
        throw error;
      }
      writeScratch("generate.log", lines.join("\n"));
    }

    writeScratch("generate.log", lines.join("\n"));
  }, 3_600_000);
});

function bumpCount(): number {
  if (!SCRATCH) {
    return 1;
  }
  const file = path.join(SCRATCH, "image-gen-count.txt");
  const current = existsSync(file) ? Number.parseInt(readFileSync(file, "utf8").trim() || "0", 10) : 0;
  const next = current + 1;
  writeFileSync(file, String(next), "utf8");
  return next;
}

function writeScratch(name: string, text: string) {
  if (!SCRATCH) {
    return;
  }
  writeFileSync(path.join(SCRATCH, name), `${text}\n`, "utf8");
}
