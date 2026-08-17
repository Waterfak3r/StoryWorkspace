import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { compileImagePrompt } from "../generate/compile-prompt";
import {
  createEntity,
  createProject,
  createScene,
  readScene,
  replaceSceneShots,
  updateEntity,
  updateScene,
  writeContentState,
} from "../fs";
import { directScene, type DirectorShotDraft } from "../director";
import { resolveContext } from "./resolve-context";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;
let workspaceRoot = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-context-evidence-"));
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

describe("context snapshot evidence", () => {
  it("writes the shipped resolveContext payload when MVP_EVIDENCE_DIR is set", () => {
    const project = createProject({ title: "Harbor Night" });
    const jill = createEntity(project.id, { kind: "character", name: "Jill" });
    const dock = createEntity(project.id, { kind: "location", name: "Dock" });
    const lantern = createEntity(project.id, { kind: "prop", name: "Lantern" });
    const coat = createEntity(project.id, { kind: "costume", name: "Watch coat" });
    updateEntity(project.id, jill.id, {
      description: "A harbor lookout",
      visual: { base: "wool coat", references: [] },
      states: { default: { outfit: "navy coat", condition: "rain-soaked" } },
      expectedUpdatedAt: jill.updatedAt,
    });
    updateEntity(project.id, dock.id, {
      description: "The quay",
      visual: { base: "wet stone", references: [] },
      states: { default: { outfit: "", condition: "wet cobbles" } },
      expectedUpdatedAt: dock.updatedAt,
    });
    updateEntity(project.id, lantern.id, {
      description: "Oil lamp",
      visual: { base: "brass lantern", references: [] },
      expectedUpdatedAt: lantern.updatedAt,
    });
    updateEntity(project.id, coat.id, {
      description: "Heavy coat",
      visual: { base: "navy wool", references: [] },
      expectedUpdatedAt: coat.updatedAt,
    });
    const scene = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      script: "Jill waits under a lantern.",
      intent: "Establish Jill waiting for a signal.",
      characters: [jill.id],
      location: dock.id,
      props: [lantern.id],
      costumes: [coat.id],
      expectedUpdatedAt: scene.updatedAt,
    });

    const drafts: DirectorShotDraft[] = [
      {
        id: "shot-01",
        purpose: "Establish the quay",
        action: "Jill stands under a lantern",
        camera: "wide, slow push-in",
        continuity_from: null,
      },
      {
        id: "shot-02",
        purpose: "Close on Jill",
        action: "Jill looks toward the water",
        camera: "medium, hold",
        continuity_from: "shot-01",
      },
    ];
    directScene(project.id, "volume-01", "chapter-01", "scene-01", () => drafts);

    const snapshot = resolveContext({
      projectId: project.id,
      volumeId: "volume-01",
      chapterId: "chapter-01",
      sceneId: "scene-01",
      shotId: "shot-02",
    });

    expect(snapshot.entities.some((entity) => entity.id === jill.id && entity.state.outfit === "navy coat")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === lantern.id && entity.kind === "prop")).toBe(true);
    expect(snapshot.entities.some((entity) => entity.id === coat.id && entity.kind === "costume")).toBe(true);
    expect(snapshot.intent).toBe("Establish Jill waiting for a signal.");
    expect(snapshot.continuity.from).toBe("shot-01");
    expect(snapshot.continuity.prior?.action).toBe("Jill stands under a lantern");
    expect(snapshot.style).toBeDefined();

    const evidenceDir = process.env.MVP_EVIDENCE_DIR;
    if (evidenceDir) {
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(path.join(evidenceDir, "context.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    }
  });

  it("stacks prior scene patches into later snapshots and compile prompts", () => {
    const project = createProject({ title: "Harbor Night" });
    const jill = createEntity(project.id, { kind: "character", name: "Jill" });
    const first = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      title: "Harbor watch",
      script: "Jill waits under a lantern.",
      intent: "Establish the wait.",
      characters: [jill.id],
      expectedUpdatedAt: first.updatedAt,
    });
    replaceSceneShots(project.id, "volume-01", "chapter-01", "scene-01", [
      pendingShot("scene-01", "shot-01", "Jill waits under a lantern"),
    ]);
    const second = createScene(project.id, "volume-01", "chapter-01", { title: "After the storm" });
    updateScene(project.id, "volume-01", "chapter-01", second.id, {
      script: "Jill stands on the dock.",
      intent: "The wait has a cost.",
      characters: [jill.id],
      expectedUpdatedAt: second.updatedAt,
    });
    replaceSceneShots(project.id, "volume-01", "chapter-01", second.id, [
      pendingShot(second.id, "shot-01", "Jill stands on the dock"),
    ]);
    writeContentState(project.id, "volume-01", "chapter-01", "scene-01", {
      patches: [{ entityId: jill.id, condition: "injured", truth: "inferred" }],
    });

    const snapA = resolveContext({
      projectId: project.id,
      volumeId: "volume-01",
      chapterId: "chapter-01",
      sceneId: "scene-01",
      shotId: "shot-01",
    });
    const snapB = resolveContext({
      projectId: project.id,
      volumeId: "volume-01",
      chapterId: "chapter-01",
      sceneId: second.id,
      shotId: "shot-01",
    });

    expect(snapA.entities.find((entity) => entity.id === jill.id)?.state.condition).toBe("");
    expect(snapB.entities.find((entity) => entity.id === jill.id)?.state.condition).toBe("injured");
    expect(snapB.storyPosition.events.some((event) => event.title === "Harbor watch")).toBe(true);
    expect(compileImagePrompt(snapB).prompt).toContain("injured");
    expect(compileImagePrompt(snapA).prompt).not.toContain("injured");
  });
});

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
    updatedAt: new Date().toISOString(),
  };
}
