import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveContext } from "../context";
import { directScene } from "../director";
import { readTree, replaceSceneShots } from "../fs";
import { ingestFixtureStory } from "../test-support/fixture-stories";
import { compileImagePrompt } from "./compile-prompt";
import { fakeImageAdapter } from "./fake-image-adapter";
import { generateShot } from "./generate-shot";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;

let workspaceRoot = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-key-beats-"));
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

describe("key-beat generate path", () => {
  it("compiles two Sue shots with one style lock and writes still files", async () => {
    const { project, confirmed } = await ingestFixtureStory("The Last Leaf", "last-leaf");
    const sue = confirmed.entities.find((entity) => entity.name === "Sue");
    expect(sue).toBeDefined();
    const scene = confirmed.scenes.find((item) => item.characters.includes(sue!.id));
    expect(scene).toBeDefined();
    const located = locateScene(project.id, scene!.id);
    expect(located).not.toBeNull();

    const shots = [
      {
        id: "shot-01",
        scene_id: scene!.id,
        purpose: "Sue enters the studio",
        action: "Sue looks out the window at the ivy vine.",
        camera: "medium two-shot, slight low angle",
        continuity_from: null,
        status: "pending" as const,
        selected_image: null,
        pageId: "",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "shot-02",
        scene_id: scene!.id,
        purpose: "Sue speaks to Johnsy",
        action: "Sue sits beside the bed and comforts Johnsy.",
        camera: "close-up, hold on the face",
        continuity_from: "shot-01",
        status: "pending" as const,
        selected_image: null,
        pageId: "",
        updatedAt: new Date().toISOString(),
      },
    ];
    replaceSceneShots(project.id, located!.volumeId, located!.chapterId, scene!.id, shots);

    const [first, second] = shots;
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

    expect(promptA).toContain(`Style: ${snapA.style.visual}`);
    expect(promptB).toContain(`Style: ${snapB.style.visual}`);
    expect(snapA.style.visual).toBe(snapB.style.visual);
    expect(promptA).toContain("Sue");
    expect(promptB).toContain("Sue");
    expect(promptA).toContain(sue!.visual.base);
    expect(promptB).toContain(sue!.visual.base);
    expect(promptA).toContain(`Action: ${first.action}`);
    expect(promptB).toContain(`Action: ${second.action}`);
    expect(first.action).not.toBe(second.action);
    expect(promptA).not.toContain(scene!.script);
    expect(promptB).not.toContain(scene!.script);

    for (const shot of [first, second]) {
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

function shotAndSuccessorNaming<T extends { purpose: string; action: string }>(shots: T[], name: string) {
  const pattern = new RegExp(`(^|[^A-Za-z])${name}(?!['’]s)(?=[^A-Za-z]|$)`, "i");
  for (let index = 0; index < shots.length - 1; index += 1) {
    const current = shots[index]!;
    if (pattern.test(`${current.purpose} ${current.action}`)) {
      return [current, shots[index + 1]!] as const;
    }
  }
  return null;
}

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
