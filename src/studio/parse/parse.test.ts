import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { StudioAiError, StudioNotFoundError } from "../errors";
import { createChapter, createProject, createVolume, getWorkspaceRoot, listEntities, readScene, readTree } from "../fs";
import { confirmParseRun } from "./confirm-parse-run";
import { parsePastedText } from "./parse-pasted-text";
import type { CompleteJson, LlmParseProposal } from "./schemas";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;

let workspaceRoot = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-parse-"));
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

describe("parse pasted text", () => {
  it("writes only a pending parse-run and no new scene or entity files", async () => {
    const project = createProject({ title: "Harbor Night" });
    const projectDir = path.join(getWorkspaceRoot(), project.id);
    const proposal = harborProposal();
    const before = {
      scenes: listSceneFiles(projectDir),
      entities: listEntityFiles(projectDir),
    };

    const run = await parsePastedText(project.id, "Jill waits on the harbor.", fakeCompleteJson(proposal));

    expect(run.status).toBe("pending");
    expect(run.id).toBe("parse-01");
    expect(existsSync(path.join(projectDir, "imports", "parse-runs", `${run.id}.json`))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(projectDir, "imports", "parse-runs", `${run.id}.json`), "utf8"))).toMatchObject({
      id: run.id,
      status: "pending",
      proposedScenes: proposal.proposedScenes,
      proposedEntities: proposal.proposedEntities,
    });
    expect(listSceneFiles(projectDir)).toEqual(before.scenes);
    expect(listEntityFiles(projectDir)).toEqual(before.entities);
    expect(listEntities(project.id, "character")).toEqual([]);
    expect(listEntities(project.id, "location")).toEqual([]);
    expect(readTree(project.id).volumes[0]?.chapters[0]?.scenes).toHaveLength(1);
  });

  it("does not write a parse run when the model JSON is invalid", async () => {
    const project = createProject({ title: "Harbor Night" });
    const projectDir = path.join(getWorkspaceRoot(), project.id);
    const filesBefore = listFiles(projectDir);

    await expect(
      parsePastedText(project.id, "Jill waits on the harbor.", async () => ({ nope: true })),
    ).rejects.toBeInstanceOf(StudioAiError);

    expect(listFiles(projectDir)).toEqual(filesBefore);
    expect(existsSync(path.join(projectDir, "imports", "parse-runs"))).toBe(false);
  });

  it("normalizes aliased messy model JSON into a pending parse run", async () => {
    const project = createProject({ title: "Harbor Night" });

    const run = await parsePastedText(project.id, "Jill waits on the harbor.", async () => ({
      scenes: [
        {
          id: "Scene_1",
          title: "Harbor watch",
          characterNames: ["Jill"],
          locationName: "Harbor",
          extra: "drop",
        },
      ],
      entities: [{ id: "Jill", kind: "Character", name: "Jill" }],
    }));

    expect(run.status).toBe("pending");
    expect(run.proposedScenes).toHaveLength(1);
    expect(run.proposedEntities).toHaveLength(1);

    const scene = run.proposedScenes[0]!;
    const entity = run.proposedEntities[0]!;

    expect(scene.key).toMatch(/^[a-z][a-z0-9-]{0,62}$/);
    expect(scene.title).toBe("Harbor watch");
    expect(scene.script).toBe("");
    expect(scene.intent).toBe("");
    expect(scene.characterNames).toEqual(["Jill"]);
    expect(scene.locationName).toBe("Harbor");
    expect(scene).not.toHaveProperty("extra");
    expect(scene).not.toHaveProperty("id");

    expect(entity.key).toMatch(/^[a-z][a-z0-9-]{0,62}$/);
    expect(entity.kind).toBe("character");
    expect(entity.name).toBe("Jill");
    expect(entity.description).toBe("");
    expect(entity).not.toHaveProperty("id");
  });
});

describe("confirm parse run", () => {
  it("writes scene, character, and location files matching the proposal", async () => {
    const project = createProject({ title: "Harbor Night" });
    const proposal = harborProposal();
    const run = await parsePastedText(project.id, "Jill waits on the harbor.", fakeCompleteJson(proposal));

    const confirmed = await confirmParseRun(project.id, run.id);

    expect(confirmed.run.status).toBe("confirmed");
    const proposedScene = proposal.proposedScenes[0]!;
    const proposedJill = proposal.proposedEntities.find((entity) => entity.kind === "character")!;
    const proposedHarbor = proposal.proposedEntities.find((entity) => entity.kind === "location")!;

    const scene = findSceneByTitle(project.id, proposedScene.title);
    const jill = listEntities(project.id, "character").find((entity) => namesEqual(entity.name, proposedJill.name));
    const harbor = listEntities(project.id, "location").find((entity) => namesEqual(entity.name, proposedHarbor.name));

    expect(scene).toBeDefined();
    expect(jill).toBeDefined();
    expect(harbor).toBeDefined();
    expect(scene?.script).toBe(proposedScene.script);
    expect(scene?.intent).toBe(proposedScene.intent);
    expect(scene?.title).toBe(proposedScene.title);
    expect(scene?.characters).toEqual([jill!.id]);
    expect(scene?.location).toBe(harbor!.id);
    expect(scene?.shots).toEqual([]);
    expect(scene?.provenance).toMatchObject({ source: "parse", parseRunId: run.id });
    expect(scene?.canonFields).toEqual(expect.arrayContaining(["title", "script", "intent"]));
    expect(jill?.description).toBe(proposedJill.description);
    expect(harbor?.description).toBe(proposedHarbor.description);
    expect(jill?.provenance).toMatchObject({ source: "parse", parseRunId: run.id });
    expect(jill?.canonFields).toEqual(expect.arrayContaining(["name", "description"]));
  });
});

describe("canon overwrite", () => {
  it("leaves a confirmed description unchanged unless overwriteCanon is set", async () => {
    const project = createProject({ title: "Harbor Night" });
    const firstProposal = harborProposal();
    const firstRun = await parsePastedText(project.id, "Jill waits on the harbor.", fakeCompleteJson(firstProposal));
    await confirmParseRun(project.id, firstRun.id);

    const firstJill = firstProposal.proposedEntities.find((entity) => entity.kind === "character")!;
    const laterProposal = {
      ...firstProposal,
      proposedEntities: firstProposal.proposedEntities.map((entity) =>
        entity.key === firstJill.key ? { ...entity, description: "A retired captain." } : entity,
      ),
    };
    const laterDescription = laterProposal.proposedEntities.find((entity) => entity.key === firstJill.key)!.description;

    const secondRun = await parsePastedText(project.id, "Jill still waits on the harbor.", fakeCompleteJson(laterProposal));
    await confirmParseRun(project.id, secondRun.id);

    const afterProtected = listEntities(project.id, "character").find((entity) => namesEqual(entity.name, firstJill.name));
    expect(afterProtected?.description).toBe(firstJill.description);
    expect(afterProtected?.description).not.toBe(laterDescription);

    const thirdRun = await parsePastedText(project.id, "Jill still waits on the harbor.", fakeCompleteJson(laterProposal));
    await confirmParseRun(project.id, thirdRun.id, { overwriteCanon: [`${firstJill.key}.description`] });

    const afterOverwrite = listEntities(project.id, "character").find((entity) => namesEqual(entity.name, firstJill.name));
    expect(afterOverwrite?.description).toBe(laterDescription);
  });
});

describe("confirm parse target", () => {
  it("creates new scenes under the given volume and chapter, not only volume-01/chapter-01", async () => {
    const project = createProject({ title: "Harbor Night" });
    createVolume(project.id, { id: "volume-02", title: "Volume 2" });
    createChapter(project.id, "volume-02", { id: "chapter-02", title: "Chapter 2" });

    const proposal = harborProposal();
    const run = await parsePastedText(project.id, "Jill waits on the harbor.", fakeCompleteJson(proposal));
    await confirmParseRun(project.id, run.id, { volumeId: "volume-02", chapterId: "chapter-02" });

    const projectDir = path.join(getWorkspaceRoot(), project.id);
    const targetSceneFile = path.join(
      projectDir,
      "content",
      "volumes",
      "volume-02",
      "chapters",
      "chapter-02",
      "scenes",
      "scene-01.json",
    );
    expect(existsSync(targetSceneFile)).toBe(true);

    const scene = readScene(project.id, "volume-02", "chapter-02", "scene-01");
    expect(scene.title).toBe(proposal.proposedScenes[0]!.title);
    expect(scene.script).toBe(proposal.proposedScenes[0]!.script);

    const defaultChapter = readTree(project.id).volumes
      .find((volume) => volume.id === "volume-01")
      ?.chapters.find((chapter) => chapter.id === "chapter-01");
    expect(defaultChapter?.scenes.some((item) => namesEqual(item.title, proposal.proposedScenes[0]!.title))).toBe(false);
    expect(existsSync(path.join(
      projectDir,
      "content",
      "volumes",
      "volume-01",
      "chapters",
      "chapter-01",
      "scenes",
      "scene-02.json",
    ))).toBe(false);
  });

  it("rejects confirm when the target chapter does not exist", async () => {
    const project = createProject({ title: "Harbor Night" });
    createVolume(project.id, { id: "volume-02", title: "Volume 2" });

    const projectDir = path.join(getWorkspaceRoot(), project.id);
    const entitiesBefore = listEntityFiles(projectDir);
    const scenesBefore = listSceneFiles(projectDir);

    const proposal = harborProposal();
    const run = await parsePastedText(project.id, "Jill waits on the harbor.", fakeCompleteJson(proposal));

    await expect(
      confirmParseRun(project.id, run.id, { volumeId: "volume-02", chapterId: "chapter-02" }),
    ).rejects.toBeInstanceOf(StudioNotFoundError);

    expect(listEntityFiles(projectDir)).toEqual(entitiesBefore);
    expect(listSceneFiles(projectDir)).toEqual(scenesBefore);
    expect(JSON.parse(readFileSync(path.join(projectDir, "imports", "parse-runs", `${run.id}.json`), "utf8")).status).toBe("pending");
  });
});

describe("workspace", () => {
  it("parses and confirms without STORY_WORKSPACE_DB_PATH", async () => {
    expect(process.env.STORY_WORKSPACE_DB_PATH).toBeUndefined();

    const project = createProject({ title: "Harbor Night" });
    const proposal = harborProposal();
    const run = await parsePastedText(project.id, "Jill waits on the harbor.", fakeCompleteJson(proposal));
    await confirmParseRun(project.id, run.id);

    expect(process.env.STORY_WORKSPACE_DB_PATH).toBeUndefined();
    expect(existsSync(path.join(getWorkspaceRoot(), `${project.id}.db`))).toBe(false);
    expect(listEntities(project.id, "character")).toHaveLength(1);
  });
});

function harborProposal(): LlmParseProposal {
  return {
    proposedScenes: [
      {
        key: "scene-a",
        title: "Harbor watch",
        script: "Jill waits on the harbor.",
        intent: "Establish Jill at night.",
        characterNames: ["Jill"],
        locationName: "Harbor",
      },
    ],
    proposedEntities: [
      { key: "ent-jill", kind: "character", name: "Jill", description: "A night lookout." },
      { key: "ent-harbor", kind: "location", name: "Harbor", description: "Foggy quay." },
    ],
  };
}

function fakeCompleteJson(proposal: LlmParseProposal): CompleteJson {
  return async () => proposal;
}

function findSceneByTitle(projectId: string, title: string) {
  const tree = readTree(projectId);
  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      for (const item of chapter.scenes) {
        const scene = readScene(projectId, volume.id, chapter.id, item.id);
        if (namesEqual(scene.title, title)) {
          return scene;
        }
      }
    }
  }
  return undefined;
}

function namesEqual(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function listSceneFiles(projectDir: string): string[] {
  return listFiles(path.join(projectDir, "content")).filter((relative) => /\/scenes\/[^/]+\.json$/.test(relative));
}

function listEntityFiles(projectDir: string): string[] {
  return listFiles(path.join(projectDir, "entities")).filter((relative) => relative.endsWith(".json"));
}

function listFiles(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  const names = readdirSync(dir).sort();
  const out: string[] = [];
  for (const name of names) {
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full, rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}
