import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { planScenePages } from "../comics/plan-pages";
import { readScene, readStyle, readTree } from "../fs";
import { isImageProviderConfigured } from "../settings";
import { startWorkflow } from "../workflow/start-workflow";
import type { ImageAdapter } from "./adapter";
import { openaiCompatibleImageAdapter } from "./openai-image-adapter";

const LIVE = process.env.MAGI_START === "1";
const PROJECT_ID = "the-gift-of-the-magi";
const WORKSPACE = path.resolve(".data/projects");
const LOG_DIR = process.env.MAGI_START_LOG_DIR ?? "";

describe.skipIf(!LIVE)("live Magi start/generate", () => {
  it("fills missing Magi pages through startWorkflow twice", async () => {
    process.env.STORY_WORKSPACE_ROOT = WORKSPACE;
    delete process.env.STORY_WORKSPACE_DB_PATH;
    if (LOG_DIR) {
      mkdirSync(LOG_DIR, { recursive: true });
    }

    const adapter = liveThenFakeAdapter();
    const first = await startWorkflow(PROJECT_ID, { adapter: adapter.run });
    writeLog("generate-1.log", first, adapter.notes);
    const second = await startWorkflow(PROJECT_ID, { adapter: adapter.run });
    writeLog("generate-2.log", second, adapter.notes);

    const pages = collectPlannedPages();
    const currentDir = path.join(WORKSPACE, PROJECT_ID, "outputs", "comics", "current");
    const missing = pages.filter((pageId) => !existsSync(path.join(currentDir, `${pageId}.png`)));
    const failed = collectFailedShots();
    expect(missing, `missing current pages: ${missing.join(",")}`).toEqual([]);
    expect(failed, `failed shots: ${failed.join(",")}`).toEqual([]);
    expect(first.generated.sort()).toEqual(second.skipped.filter((id) => first.generated.includes(id)).sort());
    expect(pages).toEqual(expect.arrayContaining(["page-01-01", "page-01-02", "page-02-01", "page-03-01", "page-03-02"]));
  }, 900_000);
});

function liveThenFakeAdapter() {
  const notes: string[] = [];
  const live = isImageProviderConfigured();
  if (!live) {
    notes.push("image provider not configured");
    writeUnavailable("image provider not configured");
  }
  const sizedLive: ImageAdapter = async (input) =>
    openaiCompatibleImageAdapter({
      ...input,
      provider: {
        ...input.provider,
        model: process.env.SOAK_MODEL || input.provider.model || "gpt-image-2-only1k2k",
        size: process.env.SOAK_SIZE || "1024x1024",
        quality: process.env.SOAK_QUALITY || "low",
      },
    });
  return {
    notes,
    run: (async (input) => {
      if (!live) {
        throw new Error("Image provider is not configured; refusing to write a stub page.");
      }
      try {
        return await sizedLive(input);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        notes.push(`live adapter failed: ${message}`);
        writeUnavailable(message);
        throw error;
      }
    }) satisfies ImageAdapter,
  };
}

function collectPlannedPages(): string[] {
  const tree = readTree(PROJECT_ID);
  const pages: string[] = [];
  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      for (const node of chapter.scenes) {
        const scene = readScene(PROJECT_ID, volume.id, chapter.id, node.id);
        for (const item of planScenePages(scene.id, scene.shots, readStyle(PROJECT_ID).layout)) {
          if (!pages.includes(item.pageId)) {
            pages.push(item.pageId);
          }
        }
      }
    }
  }
  return pages;
}

function collectFailedShots(): string[] {
  const tree = readTree(PROJECT_ID);
  const failed: string[] = [];
  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      for (const node of chapter.scenes) {
        const scene = readScene(PROJECT_ID, volume.id, chapter.id, node.id);
        for (const shot of scene.shots) {
          if (shot.status === "failed") {
            failed.push(`${scene.id}:${shot.id}`);
          }
        }
      }
    }
  }
  return failed;
}

function writeLog(name: string, result: unknown, notes: readonly string[]) {
  if (!LOG_DIR) {
    return;
  }
  writeFileSync(
    path.join(LOG_DIR, name),
    `${JSON.stringify({ result, notes, at: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
}

function writeUnavailable(message: string) {
  if (!LOG_DIR) {
    return;
  }
  writeFileSync(
    path.join(LOG_DIR, "image-adapter-unavailable.log"),
    `${new Date().toISOString()} ${message}\n`,
    "utf8",
  );
}
