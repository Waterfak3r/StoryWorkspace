import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { assembleStoryOutline } from "./assemble-outline";
import { ingestFixtureStory } from "../test-support/fixture-stories";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;

let workspaceRoot = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-outline-"));
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

describe("assembleStoryOutline", () => {
  it("lists every ingested scene with plot, setting, and entity names", async () => {
    const { project, confirmed } = await ingestFixtureStory("The Last Leaf", "last-leaf");
    const outline = assembleStoryOutline(project.id);

    expect(outline.title).toBe("The Last Leaf");
    expect(outline.projectId).toBe(project.id);

    const scenes = outline.volumes.flatMap((volume) => volume.chapters.flatMap((chapter) => chapter.scenes));
    const confirmedWithPlot = confirmed.scenes.filter((scene) => scene.script.trim().length > 0);
    for (const scene of confirmedWithPlot) {
      const row = scenes.find((item) => item.title === scene.title && item.plot.includes(scene.script.slice(0, 24)));
      expect(row).toBeDefined();
      expect(row!.intent.length + row!.plot.length).toBeGreaterThan(0);
    }

    const ivy = scenes.find((scene) => scene.title.includes("ivy") || scene.plot.toLowerCase().includes("leaf"));
    expect(ivy).toBeDefined();
    expect(ivy!.environment?.name).toBeTruthy();
    expect(ivy!.entities.map((entity) => entity.name)).toEqual(expect.arrayContaining(["Sue", "Johnsy"]));
  });
});
