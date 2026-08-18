import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  writeContentState,
} from "../fs";
import {
  inferSceneStatePatches,
  inferSceneStatePatchesWithLlm,
  writeInferredSceneStates,
} from "./infer-scene-state";
import { writeProviderSettings } from "../settings";

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

describe("infer-scene-state ADR 030 contracts", () => {
  it("deterministic inferSceneStatePatches returns empty array without guessing facts", () => {
    const character = {
      id: "character-01",
      kind: "character" as const,
      name: "Hero",
      description: "A brave adventurer",
      visual: { base: "Tall knight", references: [], spatial: "" },
      states: { default: { outfit: "Armor", condition: "Healthy" } },
      updatedAt: new Date().toISOString(),
    };
    const scenes = [
      locatedScene("scene-01", "Start", "Hero sets off.", "Opening", ["character-01"]),
      locatedScene("scene-02", "Battle", "Hero gets injured in battle.", "Fight", ["character-01"]),
    ];

    const inferred = inferSceneStatePatches(scenes, [character]);
    expect(inferred).toEqual([]);
  });

  it("inferSceneStatePatchesWithLlm parses LLM proposal into inferred patches and filters unattached entities", async () => {
    writeProviderSettings({
      text: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
        model: "gpt-4o",
        protocol: "chat",
      },
      image: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
        model: "dall-e-3",
        size: "1024x1024",
        quality: "standard",
      },
    });

    const character = {
      id: "character-01",
      kind: "character" as const,
      name: "Della",
      description: "A young woman",
      visual: { base: "Long hair", references: [], spatial: "" },
      states: { default: { outfit: "", condition: "long hair" } },
      updatedAt: new Date().toISOString(),
    };
    const unattached = {
      id: "character-02",
      kind: "character" as const,
      name: "Ghost",
      description: "A spirit",
      visual: { base: "Invisible", references: [], spatial: "" },
      states: { default: { outfit: "", condition: "" } },
      updatedAt: new Date().toISOString(),
    };

    const scenes = [
      locatedScene("scene-01", "Long hair", "Della lets hair down.", "Beat 1", ["character-01"]),
      locatedScene("scene-02", "After cut", "Della has short curls.", "Beat 2", ["character-01"]),
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  patches: [
                    {
                      sceneId: "scene-02",
                      entityId: "character-01",
                      condition: "short curls",
                      supersedes: ["long hair"],
                    },
                    {
                      sceneId: "scene-02",
                      entityId: "character-02",
                      condition: "floating",
                    },
                  ],
                }),
              },
            },
          ],
        }),
    });

    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const inferred = await inferSceneStatePatchesWithLlm(scenes, [character, unattached]);
    expect(inferred).toHaveLength(1);
    expect(inferred[0]?.sceneId).toBe("scene-02");
    expect(inferred[0]?.patches).toEqual([
      {
        entityId: "character-01",
        condition: "short curls",
        supersedes: ["long hair"],
        truth: "inferred",
      },
    ]);
  });

  it("persists Canon and Inferred patches and stacks entity condition in resolveContext", () => {
    const project = createProject({ title: "State Stacking Project" });
    const hero = createEntity(project.id, { kind: "character", name: "Hero" });
    updateEntity(project.id, hero.id, {
      visual: {
        base: "Tall knight with shiny armor and long brown hair",
        references: [],
        spatial: "",
      },
      states: { default: { outfit: "Iron Armor", condition: "Long brown hair" } },
      expectedUpdatedAt: hero.updatedAt,
    });

    const first = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      title: "Opening scene",
      script: "Hero leaves the castle in full gear.",
      characters: [hero.id],
      expectedUpdatedAt: first.updatedAt,
    });
    const second = createScene(project.id, "volume-01", "chapter-01", { title: "Battle aftermath" });
    updateScene(project.id, "volume-01", "chapter-01", second.id, {
      title: "Battle aftermath",
      script: "Hero cuts hair and wears a leather cloak.",
      characters: [hero.id],
      expectedUpdatedAt: second.updatedAt,
    });

    replaceSceneShots(project.id, "volume-01", "chapter-01", "scene-01", [
      pendingShot("scene-01", "shot-01", "Hero departs"),
    ]);
    replaceSceneShots(project.id, "volume-01", "chapter-01", second.id, [
      pendingShot(second.id, "shot-01", "Hero stands in battlefield"),
    ]);

    writeContentState(project.id, "volume-01", "chapter-01", second.id, {
      patches: [
        {
          entityId: hero.id,
          outfit: "Leather Cloak",
          condition: "Short cropped hair, battle scars",
          supersedes: ["long brown hair", "Iron Armor"],
          truth: "canon",
        },
      ],
    });

    const snap1 = resolveContext({
      projectId: project.id,
      volumeId: "volume-01",
      chapterId: "chapter-01",
      sceneId: "scene-01",
      shotId: "shot-01",
    });
    const snap2 = resolveContext({
      projectId: project.id,
      volumeId: "volume-01",
      chapterId: "chapter-01",
      sceneId: second.id,
      shotId: "shot-01",
    });

    const hero1 = snap1.entities.find((e) => e.id === hero.id);
    const hero2 = snap2.entities.find((e) => e.id === hero.id);

    expect(hero1?.state.outfit).toBe("Iron Armor");
    expect(hero1?.state.condition).toBe("Long brown hair");

    expect(hero2?.state.outfit).toBe("Leather Cloak");
    expect(hero2?.state.condition).toBe("Short cropped hair, battle scars");
    expect(hero2?.state.supersedes).toContain("long brown hair");
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
