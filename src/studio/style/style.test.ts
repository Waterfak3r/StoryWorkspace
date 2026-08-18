import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { entityVisualSchema, shotRecordSchema } from "../domain";
import { createProject, getWorkspaceRoot, readScene, readStyle, replaceSceneShots, updateScene, updateStyle } from "../fs";
import { fakeImageAdapter, generateShot } from "../generate";
import { applyComicsStylePatch, COMICS_STYLE_PRESETS, comicsStyleById, selectComicsLettering, selectComicsStyle } from "./index";

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
  it("defaults new projects to page compose and auto layout", () => {
    const project = createProject({ title: "Default Compose" });
    const style = readStyle(project.id);
    expect(style.compose).toBe("page");
    expect(style.layout).toBe("auto");
  });

  it("reads old entity and shot JSON missing spatial or pageId", () => {
    expect(entityVisualSchema.parse({ base: "wet brick", references: [] }).spatial).toBe("");
    expect(
      shotRecordSchema.parse({
        id: "shot-01",
        scene_id: "scene-01",
        purpose: "beat",
        action: "Wait",
        camera: "wide",
        continuity_from: null,
        status: "pending",
        selected_image: null,
        updatedAt: "2026-08-17T00:00:00.000Z",
      }).pageId,
    ).toBe("");
  });

  it("can change only compose or only layout", () => {
    const project = createProject({ title: "Patch Compose" });
    const panels = applyComicsStylePatch(project.id, { compose: "panels" });
    expect(panels.compose).toBe("panels");
    expect(panels.layout).toBe("auto");
    expect(readStyle(project.id).lettering).toBe("model");

    const four = applyComicsStylePatch(project.id, { layout: "4" });
    expect(four.compose).toBe("panels");
    expect(four.layout).toBe("4");
    expect(updateStyle(project.id, { layout: "marvel" }).layout).toBe("marvel");
  });

  it("keeps compose, layout, and lettering when the preset changes", () => {
    const project = createProject({ title: "Keep Forks" });
    applyComicsStylePatch(project.id, { compose: "panels", layout: "3", lettering: "overlay" });
    const noir = selectComicsStyle(project.id, "noir-comics");
    expect(noir.presetId).toBe("noir-comics");
    expect(noir.compose).toBe("panels");
    expect(noir.layout).toBe("3");
    expect(noir.lettering).toBe("overlay");
    expect(readStyle(project.id)).toMatchObject({
      compose: "panels",
      layout: "3",
      lettering: "overlay",
    });
  });

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
        pageId: "",
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

  it("defaults lettering to model, can change only lettering, and keeps it when the preset changes", () => {
    const project = createProject({ title: "Lettering Harbor" });
    expect(readStyle(project.id).lettering).toBe("model");

    const overlay = selectComicsLettering(project.id, "overlay");
    expect(overlay.lettering).toBe("overlay");
    expect(readStyle(project.id).lettering).toBe("overlay");

    const noir = selectComicsStyle(project.id, "noir-comics");
    expect(noir.presetId).toBe("noir-comics");
    expect(noir.lettering).toBe("overlay");
    expect(readStyle(project.id).lettering).toBe("overlay");

    const disk = JSON.parse(
      readFileSync(path.join(getWorkspaceRoot(), project.id, "styles", "default.json"), "utf8"),
    ) as { lettering?: string; presetId?: string };
    expect(disk.lettering).toBe("overlay");
    expect(disk.presetId).toBe("noir-comics");
  });
});
