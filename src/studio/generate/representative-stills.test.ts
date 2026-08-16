import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { directScene } from "../director";
import { readTree } from "../fs";
import { ingestFixtureStory } from "../test-support/fixture-stories";
import { fakeImageAdapter } from "./fake-image-adapter";
import { generateShot } from "./generate-shot";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;

let workspaceRoot = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-stills-"));
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

describe("representative comic stills", () => {
  it("writes still files for key beats of The Last Leaf", async () => {
    const { project, confirmed } = await ingestFixtureStory("The Last Leaf", "last-leaf");
    const scene = confirmed.scenes.find((item) => item.script.trim().length > 0);
    expect(scene).toBeDefined();
    const located = locateScene(project.id, scene!.id);
    expect(located).not.toBeNull();

    const directed = directScene(project.id, located!.volumeId, located!.chapterId, scene!.id);
    const shots = directed.shots.slice(0, 2);
    expect(shots.length).toBe(2);

    for (const shot of shots) {
      const result = await generateShot(
        project.id,
        located!.volumeId,
        located!.chapterId,
        scene!.id,
        shot.id,
        { mode: "generate" },
        fakeImageAdapter,
      );
      expect(result.shot.selected_image).toBeTruthy();
      expect(existsSync(path.join(workspaceRoot, project.id, result.shot.selected_image!))).toBe(true);
    }
  });
});

function locateScene(projectId: string, sceneId: string) {
  const tree = readTree(projectId);
  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      if (chapter.scenes.some((item) => item.id === sceneId)) {
        return { volumeId: volume.id, chapterId: chapter.id };
      }
    }
  }
  return null;
}
