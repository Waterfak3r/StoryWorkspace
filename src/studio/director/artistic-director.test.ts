import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { readTree } from "../fs";
import { ingestFixtureStory } from "../test-support/fixture-stories";
import { directScene, hasCameraLanguage } from "./direct-scene";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;

let workspaceRoot = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-director-"));
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

describe("artistic director on fixture stories", () => {
  it.each([
    ["last-leaf", "The Last Leaf"] as const,
    ["tell-tale", "The Tell-Tale Heart"] as const,
  ])("directs a confirmed %s scene with varied artistic cameras", async (which, title) => {
    const { project, confirmed } = await ingestFixtureStory(title, which);
    const scene = confirmed.scenes.find((item) => item.script.trim().length > 0);
    expect(scene).toBeDefined();

    const located = locateScene(project.id, scene!.id);
    expect(located).not.toBeNull();

    const directed = directScene(project.id, located!.volumeId, located!.chapterId, scene!.id);
    expect(directed.shots.length).toBeGreaterThanOrEqual(2);
    for (const shot of directed.shots) {
      expect(shot.purpose.trim().length).toBeGreaterThan(0);
      expect(shot.action.trim().length).toBeGreaterThan(0);
      expect(shot.camera.trim().length).toBeGreaterThan(0);
      expect(hasCameraLanguage(shot.camera)).toBe(true);
    }
    const cameras = new Set(directed.shots.map((shot) => shot.camera));
    expect(cameras.size).toBeGreaterThan(1);
  });
});

function locateScene(projectId: string, sceneId: string) {
  const tree = readTree(projectId);
  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      if (chapter.scenes.some((scene) => scene.id === sceneId)) {
        return { volumeId: volume.id, chapterId: chapter.id };
      }
    }
  }
  return null;
}
