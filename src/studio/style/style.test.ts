import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createProject, getWorkspaceRoot, readScene, readStyle, replaceSceneShots, updateScene } from "../fs";
import { fakeImageAdapter, generateShot } from "../generate";
import { COMICS_STYLE_PRESETS, comicsStyleById, selectComicsStyle } from "./index";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;

let workspaceRoot = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-style-"));
  process.env.STORY_WORKSPACE_ROOT = workspaceRoot;
  delete process.env.STORY_WORKSPACE_DB_PATH;
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
  if (previousWorkspaceRoot === undefined) {
    delete process.env.STORY_WORKSPACE_ROOT;
  } else {
    process.env.STORY_WORKSPACE_ROOT = previousWorkspaceRoot;
  }
  if (previousDbPath === undefined) {
    delete process.env.STORY_WORKSPACE_DB_PATH;
  } else {
    process.env.STORY_WORKSPACE_DB_PATH = previousDbPath;
  }
});

describe("comics style catalog and persistence", () => {
  it("persists a chosen preset and puts that visual into the compiled page request", async () => {
    const noir = comicsStyleById("noir-comics");
    expect(noir).toBeDefined();
    expect(noir!.visual.length).toBeGreaterThan(20);
    expect(COMICS_STYLE_PRESETS.map((preset) => preset.id)).toContain("sequential-ink");

    const project = createProject({ title: "Style Harbor" });
    const before = readStyle(project.id);
    expect(before.visual).not.toBe(noir!.visual);

    const saved = selectComicsStyle(project.id, noir!.id);
    expect(saved.presetId).toBe("noir-comics");
    expect(saved.visual).toBe(noir!.visual);
    expect(readStyle(project.id).visual).toBe(noir!.visual);

    const disk = JSON.parse(
      readFileSync(path.join(getWorkspaceRoot(), project.id, "styles", "default.json"), "utf8"),
    ) as { presetId?: string; visual: string };
    expect(disk.presetId).toBe("noir-comics");
    expect(disk.visual).toBe(noir!.visual);

    const scene = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      script: "Sue watches the harbor.",
      expectedUpdatedAt: scene.updatedAt,
    });
    replaceSceneShots(project.id, "volume-01", "chapter-01", "scene-01", [
      {
        id: "shot-01",
        scene_id: "scene-01",
        purpose: "Establish",
        action: "Sue watches the harbor.",
        camera: "wide",
        continuity_from: null,
        status: "pending",
        selected_image: null,
        updatedAt: new Date().toISOString(),
      },
    ]);

    const result = await generateShot(
      project.id,
      "volume-01",
      "chapter-01",
      "scene-01",
      "shot-01",
      { mode: "generate" },
      fakeImageAdapter,
    );

    expect(result.compiled.prompt).toContain(`Style: ${noir!.visual}`);
    expect(result.compiled.prompt).not.toContain(`Style: ${before.visual}`);
  });
});
