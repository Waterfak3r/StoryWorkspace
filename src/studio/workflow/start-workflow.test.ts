import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { defaultDirector } from "../director";
import { createEntity, createProject, createScene, getWorkspaceRoot, readScene, replaceSceneShots, updateScene } from "../fs";
import type { ImageAdapterInput } from "../generate/adapter";
import { fakeImageAdapter, isRenderableComicsFile, lockShot, STUB_PNG_BYTES } from "../generate";
import { startWorkflow } from "./start-workflow";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;
const previousUserConfig = process.env.STORY_USER_CONFIG;
const previousAiApiKey = process.env.AI_API_KEY;
const previousImageApiKey = process.env.IMAGE_API_KEY;

let workspaceRoot = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-start-workflow-"));
  process.env.STORY_WORKSPACE_ROOT = workspaceRoot;
  process.env.STORY_USER_CONFIG = path.join(workspaceRoot, "user-providers.json");
  delete process.env.STORY_WORKSPACE_DB_PATH;
  delete process.env.AI_API_KEY;
  delete process.env.IMAGE_API_KEY;
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
  restoreEnv("STORY_WORKSPACE_ROOT", previousWorkspaceRoot);
  restoreEnv("STORY_WORKSPACE_DB_PATH", previousDbPath);
  restoreEnv("STORY_USER_CONFIG", previousUserConfig);
  restoreEnv("AI_API_KEY", previousAiApiKey);
  restoreEnv("IMAGE_API_KEY", previousImageApiKey);
});

function restoreEnv(name: string, previous: string | undefined) {
  if (previous === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}

describe("startWorkflow", () => {
  it("directs empty scenes, confirms dialogue, and generates missing current pages", async () => {
    const project = createProject({ title: "Start Harbor" });
    const scene = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      script: "Jill waits under a lantern.\n\nShe looks toward the water.",
      intent: "Establish Jill waiting.",
      expectedUpdatedAt: scene.updatedAt,
    });

    const first = await startWorkflow(project.id, {
      director: defaultDirector,
      adapter: fakeImageAdapter,
    });
    expect(first.directed).toEqual(["scene-01"]);
    expect(first.confirmed).toEqual(["scene-01"]);
    expect(first.generated).toEqual(["page-01-01"]);
    expect(first.skipped).toEqual([]);

    const current = path.join(getWorkspaceRoot(), project.id, "outputs", "comics", "current", "page-01-01.png");
    expect(existsSync(current)).toBe(true);
    const directed = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    expect(directed.dialogue.status).toBe("confirmed");
    expect(directed.shots.every((shot) => shot.selected_image === "outputs/comics/current/page-01-01.png")).toBe(true);

    const second = await startWorkflow(project.id, {
      director: defaultDirector,
      adapter: fakeImageAdapter,
    });
    expect(second.directed).toEqual([]);
    expect(second.confirmed).toEqual([]);
    expect(second.generated).toEqual([]);
    expect(second.skipped).toEqual(["page-01-01"]);
  });

  it("skips a page that already has a locked shot", async () => {
    const project = createProject({ title: "Locked Harbor" });
    const scene = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      script: "Jill waits.\n\nShe turns.",
      expectedUpdatedAt: scene.updatedAt,
    });
    replaceSceneShots(project.id, "volume-01", "chapter-01", "scene-01", [
      shot("shot-01", "Jill waits.", "page-01-01"),
      shot("shot-02", "Jill turns.", "page-01-01"),
    ]);
    lockShot(project.id, "volume-01", "chapter-01", "scene-01", "shot-01");

    const seen: ImageAdapterInput[] = [];
    const result = await startWorkflow(project.id, {
      director: defaultDirector,
      adapter: async (input) => {
        seen.push(input);
        return fakeImageAdapter(input);
      },
    });
    expect(result.generated).toEqual([]);
    expect(result.skipped).toEqual(["page-01-01"]);
    expect(seen).toHaveLength(0);
  });

  it("attaches a catalog watch named in the script before generating", async () => {
    const project = createProject({ title: "Watch Harbor" });
    const watch = createEntity(project.id, { kind: "prop", name: "Jim's gold watch" });
    const scene = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      script: "Jill waits.\n\nShe sold the watch to buy a gift.",
      expectedUpdatedAt: scene.updatedAt,
    });
    replaceSceneShots(project.id, "volume-01", "chapter-01", "scene-01", [
      shot("shot-01", "Jill waits.", "page-01-01"),
      shot("shot-02", "She sold the watch.", "page-01-01"),
    ]);

    await startWorkflow(project.id, {
      director: defaultDirector,
      adapter: fakeImageAdapter,
    });
    const after = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    expect(after.props).toContain(watch.id);
  });

  it("does not direct an empty scene whose script is already covered by directed scenes", async () => {
    const project = createProject({ title: "Overlap Harbor" });
    const scene = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      script: "Jill waits under a lantern.\n\nShe looks toward the water.\n\nA bell rings twice.",
      expectedUpdatedAt: scene.updatedAt,
    });
    const first = await startWorkflow(project.id, {
      director: defaultDirector,
      adapter: fakeImageAdapter,
    });
    expect(first.directed).toEqual(["scene-01"]);

    const extra = createScene(project.id, "volume-01", "chapter-01", { title: "The same wait again" });
    const extraScene = readScene(project.id, "volume-01", "chapter-01", extra.id);
    updateScene(project.id, "volume-01", "chapter-01", extra.id, {
      script: "Jill waits under a lantern.\n\nShe looks toward the water.\n\nA bell rings twice.",
      expectedUpdatedAt: extraScene.updatedAt,
    });

    const second = await startWorkflow(project.id, {
      director: defaultDirector,
      adapter: fakeImageAdapter,
    });
    expect(second.directed).toEqual([]);
    expect(second.skipped).toContain(extra.id);
    expect(readScene(project.id, "volume-01", "chapter-01", extra.id).shots).toEqual([]);
  });

  it("regenerates a current page that is only a 1x1 stub", async () => {
    const project = createProject({ title: "Stub Harbor" });
    const scene = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      script: "Jill waits.\n\nShe turns.",
      expectedUpdatedAt: scene.updatedAt,
    });
    const currentRel = "outputs/comics/current/page-01-01.png";
    replaceSceneShots(project.id, "volume-01", "chapter-01", "scene-01", [
      shot("shot-01", "Jill waits.", "page-01-01", currentRel),
      shot("shot-02", "Jill turns.", "page-01-01", currentRel),
    ]);
    const currentAbs = path.join(getWorkspaceRoot(), project.id, "outputs", "comics", "current", "page-01-01.png");
    mkdirSync(path.dirname(currentAbs), { recursive: true });
    writeFileSync(currentAbs, STUB_PNG_BYTES);

    const seen: ImageAdapterInput[] = [];
    const result = await startWorkflow(project.id, {
      director: defaultDirector,
      adapter: async (input) => {
        seen.push(input);
        return fakeImageAdapter(input);
      },
    });
    expect(result.skipped).toEqual([]);
    expect(result.generated).toEqual(["page-01-01"]);
    expect(seen.length).toBeGreaterThan(0);
    expect(isRenderableComicsFile(currentAbs)).toBe(true);
    const after = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    expect(after.shots.every((item) => item.status === "success")).toBe(true);
  });

  it("skips leftover pages that already have selected_image paths", async () => {
    const project = createProject({ title: "Legacy Harbor" });
    const scene = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      script: "Jill waits.\n\nShe turns.",
      expectedUpdatedAt: scene.updatedAt,
    });
    const leftover = "outputs/comics/pages/page-01-01/run-01.png";
    replaceSceneShots(project.id, "volume-01", "chapter-01", "scene-01", [
      shot("shot-01", "Jill waits.", "page-01-01", leftover),
      shot("shot-02", "Jill turns.", "page-01-01", leftover),
    ]);

    const seen: ImageAdapterInput[] = [];
    const result = await startWorkflow(project.id, {
      director: defaultDirector,
      adapter: async (input) => {
        seen.push(input);
        return fakeImageAdapter(input);
      },
    });
    expect(result.generated).toEqual([]);
    expect(result.skipped).toEqual(["page-01-01"]);
    expect(seen).toHaveLength(0);
    const after = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    expect(after.shots.every((item) => item.selected_image === leftover)).toBe(true);
  });

  it("reassigns leftover confirmed speech before generating missing pages", async () => {
    const project = createProject({ title: "Magi Harbor" });
    const della = createEntity(project.id, { kind: "character", name: "Della" });
    const jim = createEntity(project.id, { kind: "character", name: "Jim" });
    const scene = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      script: [
        '“Jim, darling,” she cried.',
        '“You’ve cut off your hair?” asked Jim.',
        '“Cut it off and sold it,” said Della.',
        '“Isn’t it a dandy, Jim?”',
        '“I sold the watch to get the money to buy your combs,” said Jim.',
      ].join("\n"),
      characters: [della.id, jim.id],
      dialogue: {
        status: "confirmed",
        lines: [
          {
            id: "line-01",
            speaker: "Della",
            speakerId: della.id,
            text: "Jim, darling",
            shotId: "shot-01",
            kind: "speech",
            eventId: "evt",
          },
          {
            id: "line-02",
            speaker: "Jim",
            speakerId: jim.id,
            text: "You’ve cut off your hair?",
            shotId: "shot-01",
            kind: "speech",
            eventId: "evt",
          },
          {
            id: "line-03",
            speaker: "Della",
            speakerId: della.id,
            text: "Cut it off and sold it",
            shotId: null,
            kind: "speech",
            eventId: "evt",
          },
          {
            id: "line-04",
            speaker: "Della",
            speakerId: della.id,
            text: "Isn’t it a dandy, Jim?",
            shotId: "shot-04",
            kind: "speech",
            eventId: "evt",
          },
          {
            id: "line-05",
            speaker: "Jim",
            speakerId: jim.id,
            text: "I sold the watch to get the money to buy your combs.",
            shotId: "shot-05",
            kind: "speech",
            eventId: "evt",
          },
        ],
        confirmedAt: scene.updatedAt,
      },
      expectedUpdatedAt: scene.updatedAt,
    });
    replaceSceneShots(project.id, "volume-01", "chapter-01", "scene-01", [
      shot("shot-01", "Jim stops in the doorway and stares at Della's short hair.", "page-01-01"),
      shot("shot-02", "Della pleads that she sold her hair.", "page-01-01"),
      shot("shot-03", "Della unwraps the package of combs.", "page-01-01"),
      shot("shot-04", "Della holds out the watch chain on her palm.", "page-01-02"),
      shot("shot-05", "Jim sold his watch and sits on the couch.", "page-01-02"),
    ]);

    const first = await startWorkflow(project.id, {
      director: defaultDirector,
      adapter: fakeImageAdapter,
    });
    expect(first.confirmed).toEqual(["scene-01"]);
    expect(first.generated.sort()).toEqual(["page-01-01", "page-01-02"]);
    const assigned = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    expect(assigned.dialogue.lines.find((line) => /sold it/i.test(line.text))?.shotId).toBeTruthy();
    expect(assigned.dialogue.lines.every((line) => line.kind === "narration" || line.shotId)).toBe(true);

    const second = await startWorkflow(project.id, {
      director: defaultDirector,
      adapter: fakeImageAdapter,
    });
    expect(second.generated).toEqual([]);
    expect(second.skipped.sort()).toEqual(["page-01-01", "page-01-02"]);
  });
});

function shot(id: string, action: string, pageId: string, selectedImage: string | null = null) {
  return {
    id,
    scene_id: "scene-01",
    purpose: "beat",
    action,
    camera: "wide",
    continuity_from: null,
    status: selectedImage ? ("success" as const) : ("pending" as const),
    selected_image: selectedImage,
    pageId,
    updatedAt: new Date().toISOString(),
  };
}
