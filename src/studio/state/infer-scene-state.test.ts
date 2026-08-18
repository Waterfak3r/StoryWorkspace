import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveContext } from "../context";
import {
  createChapter,
  createEntity,
  createProject,
  createScene,
  readContentState,
  readScene,
  replaceSceneShots,
  updateEntity,
  updateScene,
} from "../fs";
import { writeParseRun } from "../parse/runs";
import { inferSceneStatePatches, writeInferredSceneStates } from "./infer-scene-state";
import { listScenesInStoryOrder } from "./story-order";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;
let workspaceRoot = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-infer-state-"));
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

describe("inferSceneStatePatches", () => {
  it("writes a haircut patch on the previous scene when the next scene already has shorn hair", () => {
    const della = { id: "character-01", kind: "character" as const, name: "Della", description: "", visual: { base: "", references: [], spatial: "" }, states: { default: { outfit: "", condition: "" } }, updatedAt: new Date().toISOString() };
    const scenes = [
      {
        volumeId: "volume-01",
        chapterId: "chapter-01",
        scene: {
          id: "scene-01",
          title: "Long hair",
          script: "Della let her hair fall to its full length.",
          intent: "Show the treasure.",
          characters: ["character-01"],
          location: null,
          props: [],
          costumes: [],
          shots: [],
          dialogue: { status: "unprocessed" as const, lines: [] },
          updatedAt: new Date().toISOString(),
        },
      },
      {
        volumeId: "volume-01",
        chapterId: "chapter-02",
        scene: {
          id: "scene-02",
          title: "After the sale",
          script: "Within forty minutes her head was covered with tiny, close-lying curls.",
          intent: "Della styles her freshly shorn hair.",
          characters: ["character-01"],
          location: null,
          props: [],
          costumes: [],
          shots: [],
          dialogue: { status: "unprocessed" as const, lines: [] },
          updatedAt: new Date().toISOString(),
        },
      },
    ];

    const inferred = inferSceneStatePatches(scenes, [della]);
    expect(inferred).toEqual([
      expect.objectContaining({
        sceneId: "scene-02",
        patches: [expect.objectContaining({ entityId: "character-01", truth: "inferred" })],
      }),
    ]);
    expect(inferred[0]?.patches[0]?.condition).toMatch(/shorn|curl|cut|hair/i);
    expect(inferred[0]?.patches.map((patch) => patch.entityId)).toEqual(["character-01"]);
  });

  it("persists inferred patches so a later Magi-like scene stacks short hair", () => {
    const project = createProject({ title: "Magi State" });
    const della = createEntity(project.id, { kind: "character", name: "Della" });
    const first = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      script: "Della let her hair fall to its full length.",
      intent: "Show the treasure.",
      characters: [della.id],
      expectedUpdatedAt: first.updatedAt,
    });
    const second = createScene(project.id, "volume-01", "chapter-01", { title: "After" });
    updateScene(project.id, "volume-01", "chapter-01", second.id, {
      script: "Within forty minutes her head was covered with tiny, close-lying curls.",
      intent: "Della styles her freshly shorn hair.",
      characters: [della.id],
      expectedUpdatedAt: second.updatedAt,
    });

    const third = createScene(project.id, "volume-01", "chapter-01", { title: "Jim returns" });
    updateScene(project.id, "volume-01", "chapter-01", third.id, {
      script: "The door opened and Jim stepped in. Della wriggled off the table.",
      intent: "Jim confronts Della's haircut and they exchange gifts.",
      characters: [della.id],
      expectedUpdatedAt: third.updatedAt,
    });
    updateEntity(project.id, della.id, {
      visual: {
        base: "young woman, knee-length brown hair, 1900s blouse",
        references: [],
        spatial: "",
      },
      states: { default: { outfit: "", condition: "knee-length brown hair, her greatest treasure" } },
      expectedUpdatedAt: della.updatedAt,
    });
    replaceSceneShots(project.id, "volume-01", "chapter-01", "scene-01", [
      pendingShot("scene-01", "shot-01", "Della lets her hair fall"),
    ]);
    replaceSceneShots(project.id, "volume-01", "chapter-01", second.id, [
      pendingShot(second.id, "shot-01", "Della curls her shorn hair"),
    ]);
    replaceSceneShots(project.id, "volume-01", "chapter-01", third.id, [
      pendingShot(third.id, "shot-01", "Jim stares at Della"),
    ]);

    const written = writeInferredSceneStates(project.id);
    expect(written.map((item) => item.sceneId)).toEqual([second.id, third.id]);
    expect(readContentState(project.id, "volume-01", "chapter-01", "scene-01")?.patches ?? []).toEqual([]);
    const stored = readContentState(project.id, "volume-01", "chapter-01", second.id);
    expect(stored?.patches[0]?.entityId).toBe(della.id);
    expect(stored?.patches[0]?.condition).toMatch(/shorn|curl|cut|hair/i);
    const later = readContentState(project.id, "volume-01", "chapter-01", third.id);
    expect(later?.patches[0]?.condition).toMatch(/shorn|curl|cut|hair/i);

    const uncut = resolveContext({
      projectId: project.id,
      volumeId: "volume-01",
      chapterId: "chapter-01",
      sceneId: "scene-01",
      shotId: "shot-01",
    });
    const cut = resolveContext({
      projectId: project.id,
      volumeId: "volume-01",
      chapterId: "chapter-01",
      sceneId: third.id,
      shotId: "shot-01",
    });
    const dellaUncut = uncut.entities.find((entity) => entity.id === della.id);
    const dellaCut = cut.entities.find((entity) => entity.id === della.id);
    expect(dellaUncut?.visual.base).toMatch(/knee-length brown hair/i);
    expect(dellaUncut?.state.condition).toMatch(/knee-length brown hair/i);
    expect(dellaUncut?.state.condition).not.toMatch(/curl/i);
    expect(dellaCut?.visual.base).toMatch(/knee-length brown hair/i);
    expect(dellaCut?.state.condition).toMatch(/shorn|curl|cut|hair/i);
    expect(dellaCut?.state.condition).not.toMatch(/knee-length/i);
  });

  it("does not put the haircut on a later shop scene that still sells the brown cascade", () => {
    const della = {
      id: "character-01",
      kind: "character" as const,
      name: "Della",
      description: "",
      visual: { base: "", references: [], spatial: "" },
      states: { default: { outfit: "", condition: "" } },
      updatedAt: new Date().toISOString(),
    };
    const inferred = inferSceneStatePatches(
      [
        locatedScene("scene-01", "Long hair", "Della let her hair fall to its full length.", "Show the treasure."),
        locatedScene(
          "scene-02",
          "After the sale",
          "Within forty minutes her head was covered with tiny, close-lying curls.",
          "Della styles her freshly shorn hair.",
        ),
        locatedScene(
          "scene-03",
          "Jim returns",
          "The door opened and Jim stepped in. Della wriggled off the table.",
          "Jim confronts Della's haircut and they exchange gifts.",
        ),
        locatedScene(
          "scene-05",
          "At Madame Sofronie's",
          "Down rippled the brown cascade. Will you buy my hair? asked Della.",
          "Della sells her hair at the shop.",
        ),
      ],
      [della],
    );

    expect(inferred.map((item) => item.sceneId)).toEqual(["scene-02", "scene-03"]);
    expect(inferred.find((item) => item.sceneId === "scene-05")).toBeUndefined();
    expect(inferred.find((item) => item.sceneId === "scene-02")?.patches[0]?.condition).toMatch(/shorn|curl|cut|hair/i);
    expect(inferred.find((item) => item.sceneId === "scene-03")?.patches[0]?.condition).toMatch(/shorn|curl|cut|hair/i);
  });

  it("establishes the haircut after the sale so a later chain-shopping scene is short-haired", () => {
    const della = {
      id: "character-01",
      kind: "character" as const,
      name: "Della",
      description: "",
      visual: { base: "", references: [], spatial: "" },
      states: { default: { outfit: "", condition: "" } },
      updatedAt: new Date().toISOString(),
    };
    const inferred = inferSceneStatePatches(
      [
        locatedScene("scene-01", "Long hair", "Della let her hair fall to its full length.", "Show the treasure."),
        locatedScene(
          "scene-05",
          "At Madame Sofronie's",
          "Down rippled the brown cascade. Will you buy my hair? asked Della. Twenty dollars, said Madame.",
          "Della sells her hair at the shop.",
        ),
        locatedScene(
          "scene-06",
          "The platinum chain",
          "She ransacked the stores and found a platinum fob chain.",
          "Della buys Jim's gift.",
        ),
      ],
      [della],
    );

    expect(inferred.map((item) => item.sceneId)).toEqual(["scene-06"]);
    expect(inferred[0]?.patches[0]?.condition).toMatch(/hair|cut|buy/i);
    expect(inferred[0]?.patches[0]?.entityId).toBe("character-01");
  });

  it("does not hang Della's haircut on Jim just because the scene names him", () => {
    const della = {
      id: "character-01",
      kind: "character" as const,
      name: "Della",
      description: "",
      visual: { base: "", references: [], spatial: "" },
      states: { default: { outfit: "", condition: "" } },
      updatedAt: new Date().toISOString(),
    };
    const jim = {
      ...della,
      id: "character-02",
      name: "Jim",
    };
    const inferred = inferSceneStatePatches(
      [
        locatedScene(
          "scene-02",
          "After the sale",
          "Within forty minutes her head was covered with tiny, close-lying curls that made her look wonderfully like a truant schoolboy. “If Jim doesn’t kill me,” she said to herself.",
          "Della styles her freshly shorn hair, prepares supper, and anxiously waits for Jim to come through the door.",
          ["character-01", "character-02"],
        ),
        locatedScene(
          "scene-06",
          "The platinum chain",
          "She ransacked the stores for Jim’s present and found a platinum fob chain.",
          "Della buys Jim's gift.",
          ["character-01", "character-02"],
        ),
        locatedScene(
          "scene-03",
          "Jim returns",
          "“You’ve cut off your hair?” asked Jim.",
          "Jim confronts Della's haircut.",
          ["character-01", "character-02"],
        ),
      ],
      [della, jim],
    );

    expect(inferred.flatMap((item) => item.patches.map((patch) => patch.entityId))).toEqual([
      "character-01",
      "character-01",
      "character-01",
    ]);
    expect(inferred.find((item) => item.sceneId === "scene-06")?.patches).toEqual([
      expect.objectContaining({ entityId: "character-01" }),
    ]);
    expect(inferred.every((item) => item.patches.every((patch) => patch.entityId !== "character-02"))).toBe(true);
  });

  it("orders infer and prior scenes by confirmed source text, not chapter id", () => {
    const project = createProject({ title: "Source Clock" });
    const della = createEntity(project.id, { kind: "character", name: "Della" });
    const curls = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    const curlsScript =
      "When Della reached home her head was covered with tiny, close-lying curls that made her look like a schoolboy.";
    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      title: "After the sale",
      script: curlsScript,
      intent: "Della styles her freshly shorn hair.",
      characters: [della.id],
      expectedUpdatedAt: curls.updatedAt,
    });
    const shopChapter = createChapter(project.id, "volume-01", { title: "Buying the Gift" });
    const shop = createScene(project.id, "volume-01", shopChapter.id, { title: "At Madame Sofronie's" });
    const shopScript =
      "Where she stopped the sign read Mme. Sofronie. Will you buy my hair? asked Della. Down rippled the brown cascade. Twenty dollars, said Madame.";
    updateScene(project.id, "volume-01", shopChapter.id, shop.id, {
      script: shopScript,
      intent: "Della sells her hair at the shop.",
      characters: [della.id],
      expectedUpdatedAt: shop.updatedAt,
    });
    replaceSceneShots(project.id, "volume-01", "chapter-01", "scene-01", [
      pendingShot("scene-01", "shot-01", "Della curls her shorn hair"),
    ]);
    replaceSceneShots(project.id, "volume-01", shopChapter.id, shop.id, [
      pendingShot(shop.id, "shot-01", "Della sells her hair"),
    ]);

    const now = new Date().toISOString();
    writeParseRun(project.id, {
      id: "parse-01",
      status: "confirmed",
      sourceText: `${shopScript}\n\n${curlsScript}`,
      proposedScenes: [
        {
          key: "scene-shop",
          title: "At Madame Sofronie's",
          script: shopScript,
          intent: "Della sells her hair at the shop.",
          characterNames: ["Della"],
          locationName: null,
          propNames: [],
          costumeNames: [],
          volumeName: "Volume 1",
          chapterName: "Buying the Gift",
        },
        {
          key: "scene-curls",
          title: "After the sale",
          script: curlsScript,
          intent: "Della styles her freshly shorn hair.",
          characterNames: ["Della"],
          locationName: null,
          propNames: [],
          costumeNames: [],
          volumeName: "Volume 1",
          chapterName: "Chapter 1",
        },
      ],
      proposedEntities: [
        { key: "ent-della", kind: "character", name: "Della", description: "A young woman." },
      ],
      createdAt: now,
      updatedAt: now,
    });

    expect(listScenesInStoryOrder(project.id).map((item) => item.scene.id)).toEqual([shop.id, "scene-01"]);

    const written = writeInferredSceneStates(project.id);
    expect(written.map((item) => item.sceneId)).toEqual(["scene-01"]);
    expect(readContentState(project.id, "volume-01", shopChapter.id, shop.id)?.patches ?? []).toEqual([]);
    expect(readContentState(project.id, "volume-01", "chapter-01", "scene-01")?.patches[0]?.condition).toMatch(/curl/i);

    const shopSnap = resolveContext({
      projectId: project.id,
      volumeId: "volume-01",
      chapterId: shopChapter.id,
      sceneId: shop.id,
      shotId: "shot-01",
    });
    const curlSnap = resolveContext({
      projectId: project.id,
      volumeId: "volume-01",
      chapterId: "chapter-01",
      sceneId: "scene-01",
      shotId: "shot-01",
    });
    const shopDella = shopSnap.entities.find((entity) => entity.id === della.id);
    const curlDella = curlSnap.entities.find((entity) => entity.id === della.id);
    expect(shopDella?.state.condition ?? "").not.toMatch(/curl/i);
    expect(curlDella?.state.condition).toMatch(/curl/i);
    expect(shopSnap.storyPosition.events.map((event) => event.title).join(" ")).not.toMatch(/after the sale/i);
  });
});

function locatedScene(
  id: string,
  title: string,
  script: string,
  intent: string,
  characters: string[] = ["character-01"],
) {
  return {
    volumeId: "volume-01",
    chapterId: "chapter-01",
    scene: {
      id,
      title,
      script,
      intent,
      characters,
      location: null,
      props: [],
      costumes: [],
      shots: [],
      dialogue: { status: "unprocessed" as const, lines: [] },
      updatedAt: new Date().toISOString(),
    },
  };
}

function pendingShot(sceneId: string, id: string, action: string) {
  return {
    id,
    scene_id: sceneId,
    purpose: "beat",
    action,
    camera: "medium",
    continuity_from: null,
    status: "pending" as const,
    selected_image: null,
    pageId: "",
    updatedAt: new Date().toISOString(),
  };
}
