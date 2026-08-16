import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveContext } from "../context";
import { directScene } from "../director";
import { readTree } from "../fs";
import { ingestFixtureStory } from "../test-support/fixture-stories";
import { compileImagePrompt } from "./compile-prompt";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;

let workspaceRoot = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-consistency-"));
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

describe("style and character identity across shots", () => {
  it("compiles two consecutive Last Leaf shots with the same style and Sue identity", async () => {
    const { project, confirmed } = await ingestFixtureStory("The Last Leaf", "last-leaf");
    const sue = confirmed.entities.find((entity) => entity.name === "Sue");
    expect(sue).toBeDefined();

    const scene = confirmed.scenes.find((item) => item.characters.includes(sue!.id) && item.script.trim().length > 0);
    expect(scene).toBeDefined();

    const located = locateScene(project.id, scene!.id);
    expect(located).not.toBeNull();

    const directed = directScene(project.id, located!.volumeId, located!.chapterId, scene!.id);
    expect(directed.shots.length).toBeGreaterThanOrEqual(2);

    const first = directed.shots[0]!;
    const second = directed.shots[1]!;
    const snapA = resolveContext({
      projectId: project.id,
      volumeId: located!.volumeId,
      chapterId: located!.chapterId,
      sceneId: scene!.id,
      shotId: first.id,
    });
    const snapB = resolveContext({
      projectId: project.id,
      volumeId: located!.volumeId,
      chapterId: located!.chapterId,
      sceneId: scene!.id,
      shotId: second.id,
    });

    const promptA = compileImagePrompt(snapA).prompt;
    const promptB = compileImagePrompt(snapB).prompt;

    expect(snapA.style.visual).toBe(snapB.style.visual);
    expect(snapA.style.visual.length).toBeGreaterThan(0);
    expect(promptA).toContain(`Style: ${snapA.style.visual}`);
    expect(promptB).toContain(`Style: ${snapB.style.visual}`);
    expect(promptA).toContain("Sue");
    expect(promptB).toContain("Sue");
    expect(promptA).toContain(sue!.visual.base);
    expect(promptB).toContain(sue!.visual.base);
    expect(promptA).toContain(`identity lock Sue: ${sue!.visual.base}`);
    expect(promptB).toContain(`identity lock Sue: ${sue!.visual.base}`);
    expect(promptA).toContain(`Action: ${first.action}`);
    expect(promptB).toContain(`Action: ${second.action}`);
    expect(first.action).not.toBe(second.action);
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
