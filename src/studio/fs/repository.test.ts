import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  StudioEditConflictError,
  StudioIdConflictError,
  StudioNotFoundError,
  StudioValidationError,
} from "../errors";
import {
  createEntity,
  createProject,
  createScene,
  getWorkspaceRoot,
  listEntities,
  listProjects,
  readEntity,
  readProject,
  readScene,
  readTree,
  updateScene,
} from "./repository";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;

let workspaceRoot = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-workspace-"));
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

describe("workspace listing and create", () => {
  it("lists and creates projects without STORY_WORKSPACE_DB_PATH", () => {
    expect(process.env.STORY_WORKSPACE_DB_PATH).toBeUndefined();
    expect(listProjects()).toEqual([]);

    const project = createProject({ title: "Harbor Night" });
    expect(project.id).toBe("harbor-night");
    expect(listProjects()).toEqual([
      { id: "harbor-night", title: "Harbor Night", updatedAt: project.updatedAt },
    ]);
    expect(existsSync(path.join(workspaceRoot, `${project.id}.db`))).toBe(false);
  });

  it("writes the default project tree and readTree includes volume-01 / chapter-01 / scene-01", () => {
    const project = createProject({ title: "Harbor Night" });
    const projectDir = path.join(getWorkspaceRoot(), project.id);

    expect(project.id).toBe("harbor-night");
    expect(readProject(project.id).id).toBe(path.basename(projectDir));

    expect(existsSync(path.join(projectDir, "project.json"))).toBe(true);
    expect(existsSync(path.join(projectDir, "content", "volumes", "volume-01", "volume.json"))).toBe(true);
    expect(
      existsSync(path.join(projectDir, "content", "volumes", "volume-01", "chapters", "chapter-01", "chapter.json")),
    ).toBe(true);
    expect(
      existsSync(
        path.join(projectDir, "content", "volumes", "volume-01", "chapters", "chapter-01", "scenes", "scene-01.json"),
      ),
    ).toBe(true);
    expect(existsSync(path.join(projectDir, "entities", "characters"))).toBe(true);
    expect(existsSync(path.join(projectDir, "entities", "locations"))).toBe(true);
    expect(existsSync(path.join(projectDir, "entities", "props"))).toBe(true);
    expect(existsSync(path.join(projectDir, "styles", "default.json"))).toBe(true);

    const raw = readFileSync(path.join(projectDir, "project.json"), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain("\n  \"id\":");
    expect(JSON.parse(raw)).toMatchObject({ schemaVersion: 1, id: "harbor-night", title: "Harbor Night" });

    const tree = readTree(project.id);
    expect(tree.volumes).toHaveLength(1);
    expect(tree.volumes[0]?.id).toBe("volume-01");
    expect(tree.volumes[0]?.title).toBe("Volume 1");
    expect(tree.volumes[0]?.chapters).toHaveLength(1);
    expect(tree.volumes[0]?.chapters[0]?.id).toBe("chapter-01");
    expect(tree.volumes[0]?.chapters[0]?.title).toBe("Chapter 1");
    expect(tree.volumes[0]?.chapters[0]?.scenes).toHaveLength(1);
    expect(tree.volumes[0]?.chapters[0]?.scenes[0]?.id).toBe("scene-01");
    expect(tree.volumes[0]?.chapters[0]?.scenes[0]?.title).toBe("Untitled scene");
    expect(tree.volumes[0]?.chapters[0]?.scenes[0]).not.toHaveProperty("script");

    const scene = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    expect(scene).toMatchObject({
      id: "scene-01",
      title: "Untitled scene",
      script: "",
      intent: "",
      characters: [],
      location: null,
      props: [],
      shots: [],
    });
  });

  it("suffixes generated project ids on collision and rejects a duplicate custom id", () => {
    const first = createProject({ title: "Harbor Night" });
    const second = createProject({ title: "Harbor Night" });
    const third = createProject({ title: "Harbor Night" });

    expect(first.id).toBe("harbor-night");
    expect(second.id).toBe("harbor-night-2");
    expect(third.id).toBe("harbor-night-3");

    createProject({ title: "Custom", id: "dockside" });
    expect(() => createProject({ title: "Other", id: "dockside" })).toThrow(StudioIdConflictError);
  });
});

describe("path safety", () => {
  const attacks = ["../", "..\\", "/etc/passwd", "C:\\Windows\\System32", "D:/secret", "\\\\server\\share"];

  it("rejects traversal, absolute, drive, and UNC ids without reading outside the temp root", () => {
    const project = createProject({ title: "Harbor Night" });
    const outsideDir = mkdtempSync(path.join(tmpdir(), "studio-outside-"));
    const outsideProject = path.join(outsideDir, "secret");
    mkdirSync(outsideProject, { recursive: true });
    writeFileSync(
      path.join(outsideProject, "project.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          id: "secret",
          title: "Should not be read",
          createdAt: "2026-03-27T00:00:00.000Z",
          updatedAt: "2026-03-27T00:00:00.000Z",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    try {
      for (const id of attacks) {
        expect(() => readProject(id), id).toThrow(StudioValidationError);
        expect(() => readScene(project.id, "volume-01", "chapter-01", id), `scene ${id}`).toThrow(
          StudioValidationError,
        );
        expect(() => readEntity(project.id, id), `entity ${id}`).toThrow(StudioValidationError);

        for (const thrown of [
          capture(() => readProject(id)),
          capture(() => readScene(project.id, "volume-01", "chapter-01", id)),
          capture(() => readEntity(project.id, id)),
        ]) {
          expect(thrown).toBeInstanceOf(StudioValidationError);
          expect(thrown.message).not.toContain(outsideDir);
          expect(thrown.message).not.toMatch(/[/\\]etc[/\\]passwd/);
          expect(thrown.message).not.toMatch(/Windows\\System32/i);
          expect(thrown.message).not.toContain("secret");
        }
      }

      expect(() => readProject("../secret")).toThrow(StudioValidationError);
      expect(() => readProject(outsideProject)).toThrow(StudioValidationError);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

describe("scene optimistic concurrency", () => {
  it("rejects a stale expectedUpdatedAt and then accepts a write with the current timestamp", () => {
    const project = createProject({ title: "Harbor Night" });
    const original = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    const scenePath = path.join(
      getWorkspaceRoot(),
      project.id,
      "content",
      "volumes",
      "volume-01",
      "chapters",
      "chapter-01",
      "scenes",
      "scene-01.json",
    );
    const first = updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      script: "First write",
      expectedUpdatedAt: original.updatedAt,
    });

    expect(first.script).toBe("First write");
    expect(first.updatedAt).not.toBe(original.updatedAt);
    const diskAfterFirst = readFileSync(scenePath, "utf8");

    let conflict: unknown;
    try {
      updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
        script: "Stale write",
        expectedUpdatedAt: original.updatedAt,
      });
    } catch (error) {
      conflict = error;
    }

    expect(conflict).toBeInstanceOf(StudioEditConflictError);
    expect((conflict as StudioEditConflictError).current).toEqual(first);
    expect(readFileSync(scenePath, "utf8")).toBe(diskAfterFirst);
    expect(readScene(project.id, "volume-01", "chapter-01", "scene-01").script).toBe("First write");

    const current = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    const second = updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      script: "Second write",
      expectedUpdatedAt: current.updatedAt,
    });

    expect(second.script).toBe("Second write");
    expect(readScene(project.id, "volume-01", "chapter-01", "scene-01").script).toBe("Second write");
  });
});

describe("scene entity links", () => {
  it("persists characters and location on updateScene", () => {
    const project = createProject({ title: "Harbor Night" });
    const jill = createEntity(project.id, { kind: "character", name: "Jill" });
    const dock = createEntity(project.id, { kind: "location", name: "Dock" });
    const original = readScene(project.id, "volume-01", "chapter-01", "scene-01");

    const updated = updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      characters: [jill.id],
      location: dock.id,
      expectedUpdatedAt: original.updatedAt,
    });

    expect(updated.characters).toEqual([jill.id]);
    expect(updated.location).toBe(dock.id);
    expect(readScene(project.id, "volume-01", "chapter-01", "scene-01")).toMatchObject({
      characters: [jill.id],
      location: dock.id,
    });

    const cleared = updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      characters: [],
      location: null,
      expectedUpdatedAt: updated.updatedAt,
    });
    expect(cleared.characters).toEqual([]);
    expect(cleared.location).toBeNull();
  });
});

describe("entities", () => {
  it("creates entities and lists them filtered by kind", () => {
    const project = createProject({ title: "Harbor Night" });
    const jill = createEntity(project.id, { kind: "character", name: "Jill" });
    const jack = createEntity(project.id, { kind: "character", name: "Jack" });
    const dock = createEntity(project.id, { kind: "location", name: "Dock" });

    expect(jill.id).toBe("character-01");
    expect(jack.id).toBe("character-02");
    expect(dock.id).toBe("location-01");

    expect(listEntities(project.id, "character").map((entity) => entity.id)).toEqual([
      "character-01",
      "character-02",
    ]);
    expect(listEntities(project.id, "location").map((entity) => entity.id)).toEqual(["location-01"]);
    expect(readEntity(project.id, jill.id)).toMatchObject({
      id: "character-01",
      kind: "character",
      name: "Jill",
      description: "",
      visual: { base: "", references: [] },
      states: { default: { outfit: "", condition: "" } },
    });
  });
});

describe("project isolation", () => {
  it("does not let project B read an entity or extra scene that only exists in project A", () => {
    const alpha = createProject({ title: "Alpha Dock" });
    const beta = createProject({ title: "Beta Harbor" });

    const jill = createEntity(alpha.id, { kind: "character", name: "Jill" });
    expect(() => readEntity(beta.id, jill.id)).toThrow(StudioNotFoundError);

    const special = createScene(alpha.id, "volume-01", "chapter-01", { id: "scene-special", title: "Only in A" });
    expect(special.id).toBe("scene-special");
    expect(() => readScene(beta.id, "volume-01", "chapter-01", "scene-special")).toThrow(StudioNotFoundError);
  });

  it("keeps two project directories independent", () => {
    const alpha = createProject({ title: "Alpha Dock" });
    const beta = createProject({ title: "Beta Harbor" });
    const root = getWorkspaceRoot();

    const alphaScene = readScene(alpha.id, "volume-01", "chapter-01", "scene-01");
    updateScene(alpha.id, "volume-01", "chapter-01", "scene-01", {
      script: "Only alpha",
      expectedUpdatedAt: alphaScene.updatedAt,
    });

    expect(alpha.id).not.toBe(beta.id);
    expect(existsSync(path.join(root, alpha.id, "project.json"))).toBe(true);
    expect(existsSync(path.join(root, beta.id, "project.json"))).toBe(true);
    expect(readProject(alpha.id).title).toBe("Alpha Dock");
    expect(readProject(beta.id).title).toBe("Beta Harbor");
    expect(readScene(alpha.id, "volume-01", "chapter-01", "scene-01").script).toBe("Only alpha");
    expect(readScene(beta.id, "volume-01", "chapter-01", "scene-01").script).toBe("");
    expect(readTree(alpha.id).volumes[0]?.chapters[0]?.scenes).toHaveLength(1);
    expect(readTree(beta.id).volumes[0]?.chapters[0]?.scenes).toHaveLength(1);
  });
});

function capture(run: () => void): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw error;
  }

  throw new Error("Expected the call to throw.");
}
