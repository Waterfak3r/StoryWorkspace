import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveContext } from "../context";
import {
  createEntity,
  createProject,
  getWorkspaceRoot,
  readScene,
  updateEntity,
  updateScene,
} from "../fs";
import { directScene, updateShot, type DirectorShotDraft } from "./index";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;

let workspaceRoot = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-storyboard-"));
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

describe("storyboard director and context", () => {
  it("writes at least two shots from director and persists a PATCH field on disk", () => {
    expect(process.env.STORY_WORKSPACE_DB_PATH).toBeUndefined();
    const fixture = seedDirectedHarbor();
    expect(fixture.scene.shots.length).toBeGreaterThanOrEqual(2);

    const target = fixture.scene.shots[0]!;
    const patched = updateShot(fixture.project.id, "volume-01", "chapter-01", "scene-01", target.id, {
      purpose: "Patched establish",
      expectedUpdatedAt: target.updatedAt,
    });

    expect(patched.purpose).toBe("Patched establish");
    const disk = JSON.parse(readFileSync(fixture.scenePath, "utf8")) as {
      shots: Array<{ id: string; purpose: string }>;
    };
    expect(disk.shots.find((shot) => shot.id === target.id)?.purpose).toBe("Patched establish");
    expect(readScene(fixture.project.id, "volume-01", "chapter-01", "scene-01").shots.find((shot) => shot.id === target.id)?.purpose).toBe(
      "Patched establish",
    );
  });

  it("includes entity identity and state, style.visual, scene.intent, and prior-shot continuity in the shot-02 snapshot", () => {
    const fixture = seedDirectedHarbor();
    const snapshot = resolveContext({
      projectId: fixture.project.id,
      volumeId: "volume-01",
      chapterId: "chapter-01",
      sceneId: "scene-01",
      shotId: "shot-02",
    });

    const jill = snapshot.entities.find((entity) => entity.id === fixture.characterId);
    const dock = snapshot.entities.find((entity) => entity.id === fixture.locationId);
    expect(jill).toMatchObject({
      id: fixture.characterId,
      kind: "character",
      name: "Jill",
      description: "A harbor lookout",
      visual: { base: "wool coat, lantern light", references: [] },
      state: { outfit: "navy coat", condition: "rain-soaked" },
    });
    expect(dock).toMatchObject({
      id: fixture.locationId,
      kind: "location",
      name: "Dock",
      state: { outfit: "", condition: "wet cobbles" },
    });
    expect(snapshot.style.visual).toBe("Noir harbor night, wet cobblestones");
    expect(snapshot.scene.intent).toBe("Establish Jill waiting for a signal.");
    expect(snapshot.intent).toBe("Establish Jill waiting for a signal.");
    expect(snapshot.continuity.from).toBe("shot-01");
    expect(snapshot.continuity.prior).toEqual({
      purpose: "Establish the quay",
      action: "Jill stands under a lantern",
      camera: "wide, slow push-in",
    });
  });

  it("returns a JSON-serializable snapshot object with the expected keys", () => {
    const fixture = seedDirectedHarbor();
    const snapshot = resolveContext({
      projectId: fixture.project.id,
      volumeId: "volume-01",
      chapterId: "chapter-01",
      sceneId: "scene-01",
      shotId: "shot-02",
    });

    const parsed = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
    expect(parsed).toEqual(snapshot);
    expect(parsed).toEqual(
      expect.objectContaining({
        scene: expect.any(Object),
        entities: expect.any(Array),
        style: expect.any(Object),
        intent: expect.any(String),
        shot: expect.any(Object),
        continuity: expect.any(Object),
      }),
    );
    expect(Object.keys(parsed).sort()).toEqual(["continuity", "entities", "intent", "scene", "shot", "style"]);
    expect(parsed).not.toHaveProperty("provider");
    expect(parsed).not.toHaveProperty("model");
    expect(parsed).not.toHaveProperty("temperature");
  });
});

function seedDirectedHarbor() {
  const project = createProject({ title: "Harbor Night" });
  const jill = createEntity(project.id, { kind: "character", name: "Jill" });
  const dock = createEntity(project.id, { kind: "location", name: "Dock" });

  updateEntity(project.id, jill.id, {
    description: "A harbor lookout",
    visual: { base: "wool coat, lantern light", references: [] },
    states: { default: { outfit: "navy coat", condition: "rain-soaked" } },
    expectedUpdatedAt: jill.updatedAt,
  });
  updateEntity(project.id, dock.id, {
    description: "The quay at night",
    visual: { base: "wet stone, lanterns", references: [] },
    states: { default: { outfit: "", condition: "wet cobbles" } },
    expectedUpdatedAt: dock.updatedAt,
  });

  writeStyleVisual(project.id, "Noir harbor night, wet cobblestones");

  const scene = readScene(project.id, "volume-01", "chapter-01", "scene-01");
  updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
    script: "Jill waits under a lantern.\n\nShe looks toward the water.",
    intent: "Establish Jill waiting for a signal.",
    characters: [jill.id],
    location: dock.id,
    expectedUpdatedAt: scene.updatedAt,
  });

  const directed = directScene(project.id, "volume-01", "chapter-01", "scene-01", harborDirector);
  return {
    project,
    characterId: jill.id,
    locationId: dock.id,
    scene: directed,
    scenePath: path.join(
      getWorkspaceRoot(),
      project.id,
      "content",
      "volumes",
      "volume-01",
      "chapters",
      "chapter-01",
      "scenes",
      "scene-01.json",
    ),
  };
}

function harborDirector(): DirectorShotDraft[] {
  return [
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
}

function writeStyleVisual(projectId: string, visual: string) {
  const file = path.join(getWorkspaceRoot(), projectId, "styles", "default.json");
  const style = JSON.parse(readFileSync(file, "utf8")) as { id: string; label: string; visual: string; updatedAt: string };
  writeFileSync(file, `${JSON.stringify({ ...style, visual }, null, 2)}\n`, "utf8");
}
