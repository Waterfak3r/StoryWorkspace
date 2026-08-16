import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createEntity, createProject } from "../fs";
import { FAKE_PNG_BYTES } from "./fake-image-adapter";
import {
  addEntityReferenceImage,
  identityReferencePromptLines,
  loadEntityReferenceImages,
} from "./entity-references";

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
});
