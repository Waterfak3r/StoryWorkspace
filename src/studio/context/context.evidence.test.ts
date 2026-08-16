import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createEntity, createProject, readScene, updateEntity, updateScene } from "../fs";
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
    const scene = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      script: "Jill waits under a lantern.",
      intent: "Establish Jill waiting for a signal.",
      characters: [jill.id],
      location: dock.id,
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
});
