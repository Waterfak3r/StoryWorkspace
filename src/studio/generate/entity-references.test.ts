import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createEntity,
  createProject,
  getWorkspaceRoot,
  readScene,
  readStyle,
  replaceSceneShots,
  updateScene,
} from "../fs";
import type { ImageAdapterInput } from "./adapter";
import { completeEntityReference, compileEntityReferencePrompt } from "./complete-reference";
import {
  addEntityReferenceImage,
  identityReferencePromptLines,
  loadEntityReferenceImages,
} from "./entity-references";
import { FAKE_PNG_BYTES, fakeImageAdapter, generateShot } from "./index";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;

let workspaceRoot = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-entity-refs-"));
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

describe("entity reference images", () => {
  it("loads on-disk reference bytes instead of treating the path as the image", () => {
    const project = createProject({ title: "Harbor Night" });
    const sue = createEntity(project.id, { kind: "character", name: "Sue" });
    const { entity, relativePath } = addEntityReferenceImage(project.id, sue.id, FAKE_PNG_BYTES, "sue.png");

    expect(relativePath).toBe(`assets/images/${sue.id}/ref-01.png`);
    expect(entity.visual.references).toEqual([relativePath]);

    const loaded = loadEntityReferenceImages(project.id, [entity]);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.bytes.equals(FAKE_PNG_BYTES)).toBe(true);
    expect(loaded[0]?.entityName).toBe("Sue");
    expect(identityReferencePromptLines(loaded).join("\n")).toContain("Attached image 1: character Sue");
    expect(identityReferencePromptLines(loaded).join("\n")).not.toMatch(/^reference: assets\/images\//);
  });

  it("ignores missing reference paths so generation can fall back to text locks", () => {
    const project = createProject({ title: "Harbor Night" });
    const loaded = loadEntityReferenceImages(project.id, [
      {
        id: "character-01",
        name: "Sue",
        kind: "character",
        visual: { references: ["assets/images/character-01/missing.png"] },
      },
    ]);
    expect(loaded).toEqual([]);
  });

  it("auto-completes a missing reference into a real image file used as bytes on generate", async () => {
    const project = createProject({ title: "Harbor Night" });
    const sue = createEntity(project.id, { kind: "character", name: "Sue" });
    expect(sue.visual.references).toEqual([]);

    const style = readStyle(project.id);
    const compiled = compileEntityReferencePrompt(sue, style);
    expect(compiled).toContain(`Style: ${style.visual}`);
    expect(compiled).toContain("Subject: Sue");
    expect(compiled).not.toContain("speech: ");

    const completed = await completeEntityReference(project.id, sue.id, fakeImageAdapter);
    expect(completed.relativePath).toBe(`assets/images/${sue.id}/ref-01.png`);
    expect(completed.entity.visual.references).toEqual([completed.relativePath]);
    expect(completed.compiled).toBe(compiled);

    const absolute = path.join(getWorkspaceRoot(), project.id, ...completed.relativePath.split("/"));
    expect(existsSync(absolute)).toBe(true);
    expect(readFileSync(absolute).equals(FAKE_PNG_BYTES)).toBe(true);

    const scene = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      characters: [sue.id],
      expectedUpdatedAt: scene.updatedAt,
    });
    replaceSceneShots(project.id, "volume-01", "chapter-01", "scene-01", [
      {
        id: "shot-01",
        scene_id: "scene-01",
        purpose: "Establish",
        action: "Sue waits at the desk.",
        camera: "medium",
        continuity_from: null,
        status: "pending",
        selected_image: null,
        pageId: "",
        updatedAt: new Date().toISOString(),
      },
    ]);

    const seen: ImageAdapterInput[] = [];
    const result = await generateShot(
      project.id,
      "volume-01",
      "chapter-01",
      "scene-01",
      "shot-01",
      { mode: "generate" },
      async (input) => {
        seen.push(input);
        return fakeImageAdapter(input);
      },
    );

    expect(seen[0]?.referenceImages?.length).toBe(1);
    expect(seen[0]?.referenceImages?.[0]?.bytes.equals(FAKE_PNG_BYTES)).toBe(true);
    expect(result.compiled.prompt).toContain("Attached image 1: character Sue");
  });
});
