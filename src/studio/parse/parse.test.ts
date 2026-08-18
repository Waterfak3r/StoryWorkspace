import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { StudioAiError, StudioNotFoundError } from "../errors";
import {
  createChapter,
  createEntity,
  createProject,
  createVolume,
  getWorkspaceRoot,
  listEntities,
  readScene,
  readTree,
} from "../fs";
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

  it("includes an existing entity catalog in the completeJson user prompt", async () => {
    const project = createProject({ title: "Harbor Night" });
    createEntity(project.id, { kind: "costume", name: "Wool coat" });

    let capturedPrompt = "";
    const run = await parsePastedText(project.id, "Jill waits on the harbor in a Wool coat.", async (_schema, prompt) => {
      capturedPrompt = prompt;
      return harborProposal();
    });

    expect(capturedPrompt).toContain("costume: Wool coat");
    expect(capturedPrompt).toContain("Existing reusable entities");
    expect(capturedPrompt).toContain("Jill waits on the harbor in a Wool coat.");
    expect(run.status).toBe("pending");
    expect(existsSync(path.join(getWorkspaceRoot(), project.id, "imports", "parse-runs", `${run.id}.json`))).toBe(true);
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
          propNames: ["Lantern"],
          costumeNames: ["Watch coat"],
          extra: "drop",
        },
      ],
      entities: [
        { id: "Jill", kind: "Character", name: "Jill" },
        { kind: "道具", name: "Lantern", description: "Oil lamp." },
        { kind: "服饰", name: "Watch coat", description: "Heavy navy coat." },
      ],
    }));

    expect(run.status).toBe("pending");
    expect(run.proposedScenes).toHaveLength(1);
    expect(run.proposedEntities).toHaveLength(3);

    const scene = run.proposedScenes[0]!;
    const entity = run.proposedEntities[0]!;
    const prop = run.proposedEntities[1]!;
    const costume = run.proposedEntities[2]!;

    expect(scene.key).toMatch(/^[a-z][a-z0-9-]{0,62}$/);
    expect(scene.title).toBe("Harbor watch");
    expect(scene.script).toBe("Jill waits on the harbor.");
    expect(scene.intent).toBe("");
    expect(scene.characterNames).toEqual(["Jill"]);
    expect(scene.locationName).toBe("Harbor");
    expect(scene.propNames).toEqual(["Lantern"]);
    expect(scene.costumeNames).toEqual(["Watch coat"]);
    expect(scene).not.toHaveProperty("extra");
    expect(scene).not.toHaveProperty("id");

    expect(entity.key).toMatch(/^[a-z][a-z0-9-]{0,62}$/);
    expect(entity.kind).toBe("character");
    expect(entity.name).toBe("Jill");
    expect(entity.description).toBe("");
    expect(entity).not.toHaveProperty("id");
    expect(prop.kind).toBe("prop");
    expect(prop.name).toBe("Lantern");
    expect(costume.kind).toBe("costume");
    expect(costume.name).toBe("Watch coat");
  });

  it("normalizes snake_case, Chinese kinds, and drops unknown entities", async () => {
    const project = createProject({ title: "Harbor Night" });

    const run = await parsePastedText(project.id, "Jill waits on the harbor.", async () => ({
      proposed_scenes: [
        {
          name: "Harbor watch",
          characters: ["Jill"],
        },
      ],
      proposed_entities: [
        { kind: "角色", name: "Jill" },
        { kind: "地点", title: "Harbor" },
        { kind: "组织", name: "Guild" },
      ],
    }));

    expect(run.status).toBe("pending");
    expect(run.proposedScenes).toHaveLength(1);
    expect(run.proposedEntities).toHaveLength(2);

    const scene = run.proposedScenes[0]!;
    expect(scene.title).toBe("Harbor watch");
    expect(scene.characterNames).toEqual(["Jill"]);
    expect(scene.propNames).toEqual([]);
    expect(scene.costumeNames).toEqual([]);
    expect(scene).toHaveProperty("propNames");
    expect(scene).toHaveProperty("costumeNames");

    expect(run.proposedEntities.map((entity) => entity.kind).sort()).toEqual(["character", "location"]);
    expect(run.proposedEntities.find((entity) => entity.kind === "character")?.name).toBe("Jill");
    expect(run.proposedEntities.find((entity) => entity.kind === "location")?.name).toBe("Harbor");
    expect(run.proposedEntities.some((entity) => entity.name === "Guild")).toBe(false);
  });

  it("replaces abridged model scripts with the full pasted source", async () => {
    const project = createProject({ title: "Harbor Night" });
    const sourceText = [
      "Night on the quay.",
      'Jill: "Any ships?"',
      'Tom: "None yet."',
    ].join("\n");

    const run = await parsePastedText(
      project.id,
      sourceText,
      fakeCompleteJson({
        proposedScenes: [
          {
            key: "scene-a",
            title: "Harbor watch",
            script: "Jill waits.",
            intent: "Establish Jill at night.",
            characterNames: ["Jill"],
            locationName: "Harbor",
            propNames: [],
            costumeNames: [],
          },
        ],
        proposedEntities: [
          { key: "ent-jill", kind: "character", name: "Jill", description: "A night lookout." },
          { key: "ent-harbor", kind: "location", name: "Harbor", description: "Foggy quay." },
        ],
      }),
    );

    expect(run.proposedScenes).toHaveLength(1);
    expect(run.proposedScenes[0]!.script).toBe(sourceText);
    expect(run.proposedScenes[0]!.key).toBe("scene-a");
    expect(run.proposedScenes[0]!.title).toBe("Harbor watch");
    expect(run.proposedEntities).toHaveLength(2);
  });

  it("keeps model scripts when they already cover the source dialogue", async () => {
    const project = createProject({ title: "Harbor Night" });
    const sourceText = [
      "Night on the quay.",
      'Jill: "Any ships?"',
      'Tom: "None yet."',
    ].join("\n");
    const modelScript = [
      "Night on the quay.",
      'Jill: "Any ships?"',
      'Tom: "None yet."',
    ].join("\n");

    const run = await parsePastedText(
      project.id,
      sourceText,
      fakeCompleteJson({
        proposedScenes: [
          {
            key: "scene-a",
            title: "Harbor watch",
            script: modelScript,
            intent: "Establish Jill at night.",
            characterNames: ["Jill", "Tom"],
            locationName: "Harbor",
            propNames: [],
            costumeNames: [],
          },
        ],
        proposedEntities: [
          { key: "ent-jill", kind: "character", name: "Jill", description: "A night lookout." },
          { key: "ent-tom", kind: "character", name: "Tom", description: "A deckhand." },
          { key: "ent-harbor", kind: "location", name: "Harbor", description: "Foggy quay." },
        ],
      }),
    );

    expect(run.proposedScenes).toHaveLength(1);
    expect(run.proposedScenes[0]!.script).toBe(modelScript);
    expect(run.proposedScenes[0]!.characterNames).toEqual(["Jill", "Tom"]);
  });

  it("redistributes the source across thin multi-scene synopses so scripts cover the original wording", async () => {
    const project = createProject({ title: "Harbor Night" });
    const sourceText = [
      "INT. HARBOR - NIGHT",
      'Jill: "Any ships on the horizon?"',
      "Tom checks the glass.",
      'Tom: "Fog only. We wait."',
      "Jill nods and keeps watch.",
    ].join("\n");

    const run = await parsePastedText(
      project.id,
      sourceText,
      fakeCompleteJson({
        proposedScenes: [
          {
            key: "scene-a",
            title: "Harbor watch",
            script: "Jill asks about ships.",
            intent: "Open.",
            characterNames: ["Jill"],
            locationName: "Harbor",
            propNames: ["Lantern"],
            costumeNames: [],
          },
          {
            key: "scene-b",
            title: "Fog reply",
            script: "Tom answers.",
            intent: "Reply.",
            characterNames: ["Tom"],
            locationName: null,
            propNames: [],
            costumeNames: ["Watch coat"],
          },
        ],
        proposedEntities: [
          { key: "ent-jill", kind: "character", name: "Jill", description: "A night lookout." },
          { key: "ent-tom", kind: "character", name: "Tom", description: "A deckhand." },
          { key: "ent-harbor", kind: "location", name: "Harbor", description: "Foggy quay." },
        ],
      }),
    );

    expect(run.proposedScenes).toHaveLength(2);
    expect(run.proposedScenes.map((scene) => scene.script).join("\n")).toBe(sourceText);
    const jillScene = run.proposedScenes.find((scene) => /Any ships/i.test(scene.script));
    const tomScene = run.proposedScenes.find((scene) => /Fog only/i.test(scene.script));
    expect(jillScene).toBeDefined();
    expect(tomScene).toBeDefined();
    expect(jillScene!.characterNames).toEqual(expect.arrayContaining(["Jill"]));
    expect(tomScene!.characterNames).toEqual(expect.arrayContaining(["Tom"]));
    for (const scene of run.proposedScenes) {
      if (/\bJill\b/.test(scene.script)) {
        expect(scene.characterNames).toContain("Jill");
      }
      if (/\bTom\b/.test(scene.script)) {
        expect(scene.characterNames).toContain("Tom");
      }
    }
    expect(run.proposedEntities).toEqual([
      { key: "ent-jill", kind: "character", name: "Jill", description: "A night lookout." },
      { key: "ent-tom", kind: "character", name: "Tom", description: "A deckhand." },
      { key: "ent-harbor", kind: "location", name: "Harbor", description: "Foggy quay." },
    ]);
  });
});

describe("confirm parse run", () => {
  it("writes scene, character, location, prop, and costume files matching the proposal", async () => {
    const project = createProject({ title: "Harbor Night" });
    const projectDir = path.join(getWorkspaceRoot(), project.id);
    const proposal = harborProposal();
    const run = await parsePastedText(project.id, "Jill waits on the harbor.", fakeCompleteJson(proposal));

    const confirmed = await confirmParseRun(project.id, run.id);

    expect(confirmed.run.status).toBe("confirmed");
    const proposedScene = proposal.proposedScenes[0]!;
    const proposedJill = proposal.proposedEntities.find((entity) => entity.kind === "character")!;
    const proposedHarbor = proposal.proposedEntities.find((entity) => entity.kind === "location")!;
    const proposedLantern = proposal.proposedEntities.find((entity) => entity.kind === "prop")!;
    const proposedCoat = proposal.proposedEntities.find((entity) => entity.kind === "costume")!;

    const scene = findSceneByTitle(project.id, proposedScene.title);
    const jill = listEntities(project.id, "character").find((entity) => namesEqual(entity.name, proposedJill.name));
    const harbor = listEntities(project.id, "location").find((entity) => namesEqual(entity.name, proposedHarbor.name));
    const lantern = listEntities(project.id, "prop").find((entity) => namesEqual(entity.name, proposedLantern.name));
    const coat = listEntities(project.id, "costume").find((entity) => namesEqual(entity.name, proposedCoat.name));

    expect(scene).toBeDefined();
    expect(jill).toBeDefined();
    expect(harbor).toBeDefined();
    expect(lantern).toBeDefined();
    expect(coat).toBeDefined();
    expect(existsSync(path.join(projectDir, "entities", "props", `${lantern!.id}.json`))).toBe(true);
    expect(existsSync(path.join(projectDir, "entities", "costumes", `${coat!.id}.json`))).toBe(true);
    expect(scene?.script).toBe(proposedScene.script);
    expect(scene?.intent).toBe(proposedScene.intent);
    expect(scene?.title).toBe(proposedScene.title);
    expect(scene?.characters).toEqual([jill!.id]);
    expect(scene?.location).toBe(harbor!.id);
    expect(scene?.props).toEqual([lantern!.id]);
    expect(scene?.costumes).toEqual([coat!.id]);
    expect(scene?.shots).toEqual([]);
    expect(scene?.provenance).toMatchObject({ source: "parse", parseRunId: run.id });
    expect(scene?.canonFields).toEqual(expect.arrayContaining(["title", "script", "intent"]));
    expect(jill?.description).toBe(proposedJill.description);
    expect(harbor?.description).toBe(proposedHarbor.description);
    expect(lantern?.description).toBe(proposedLantern.description);
    expect(coat?.description).toBe(proposedCoat.description);
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
    const targetChapter = readTree(project.id).volumes
      .find((volume) => volume.id === "volume-02")
      ?.chapters.find((chapter) => chapter.id === "chapter-02");
    expect(targetChapter?.scenes.length).toBeGreaterThan(0);
    const createdId = targetChapter!.scenes[0]!.id;
    expect(existsSync(path.join(projectDir, "content", "volumes", "volume-02", "chapters", "chapter-02", "scenes", `${createdId}.json`))).toBe(true);

    const scene = readScene(project.id, "volume-02", "chapter-02", createdId);
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

  it("creates chapters from proposed chapter names instead of dumping every scene into the selection", async () => {
    const project = createProject({ title: "Harbor Night" });
    const proposal: LlmParseProposal = {
      proposedScenes: [
        {
          key: "scene-a",
          title: "Harbor watch",
          script: "Jill waits on the harbor.",
          intent: "Open.",
          characterNames: ["Jill"],
          locationName: "Harbor",
          propNames: [],
          costumeNames: [],
          volumeName: "Harbor Night",
          chapterName: "Night watch",
        },
        {
          key: "scene-b",
          title: "Dawn signal",
          script: "Jill sees a lantern.",
          intent: "Close.",
          characterNames: ["Jill"],
          locationName: "Harbor",
          propNames: [],
          costumeNames: [],
          volumeName: "Harbor Night",
          chapterName: "Dawn",
        },
      ],
      proposedEntities: [
        { key: "ent-jill", kind: "character", name: "Jill", description: "A night lookout." },
        { key: "ent-harbor", kind: "location", name: "Harbor", description: "Foggy quay." },
      ],
    };

    const run = await parsePastedText(project.id, "Jill waits on the harbor.\n\nJill sees a lantern.", fakeCompleteJson(proposal));
    await confirmParseRun(project.id, run.id, { volumeId: "volume-01", chapterId: "chapter-01" });

    const tree = readTree(project.id);
    const volume = tree.volumes[0]!;
    expect(volume.title).toBe("Harbor Night");
    const chapterTitles = volume.chapters.map((chapter) => chapter.title);
    expect(chapterTitles).toEqual(expect.arrayContaining(["Night watch", "Dawn"]));
    expect(chapterTitles).not.toContain("Chapter 1");

    const night = volume.chapters.find((chapter) => chapter.title === "Night watch");
    const dawn = volume.chapters.find((chapter) => chapter.title === "Dawn");
    expect(night?.scenes.map((item) => item.title)).toEqual(["Harbor watch"]);
    expect(dawn?.scenes.map((item) => item.title)).toEqual(["Dawn signal"]);
    expect(night?.scenes.some((item) => item.title === "Untitled scene")).toBe(false);
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

  it("adds newly found props onto a matched scene without rewriting its script", async () => {
    const project = createProject({ title: "Harbor Night" });
    const first = await parsePastedText(project.id, "Jill waits on the harbor.", fakeCompleteJson(harborProposal()));
    await confirmParseRun(project.id, first.id);
    const before = findSceneByTitle(project.id, "Harbor watch")!;
    expect(before.props).toHaveLength(1);

    const later: LlmParseProposal = {
      ...harborProposal(),
      proposedScenes: [
        {
          ...harborProposal().proposedScenes[0]!,
          script: "Jill waits on the harbor.",
          propNames: ["Lantern", "Gold watch"],
        },
      ],
      proposedEntities: [
        ...harborProposal().proposedEntities,
        { key: "ent-watch", kind: "prop", name: "Gold watch", description: "Family gold watch." },
      ],
    };
    const second = await parsePastedText(project.id, "Jill waits on the harbor.", fakeCompleteJson(later));
    await confirmParseRun(project.id, second.id);
    const after = findSceneByTitle(project.id, "Harbor watch")!;
    expect(after.script).toBe(before.script);
    const props = listEntities(project.id, "prop");
    const watch = props.find((entity) => /watch/i.test(entity.name));
    expect(watch).toBeTruthy();
    expect(after.props).toContain(watch!.id);
    expect(after.props).toEqual(expect.arrayContaining(before.props));
  });

  it("rematches a second parse by script coverage instead of duplicating leftover titles", async () => {
    const opening =
      "One dollar and eighty-seven cents. Della let her hair fall to its full length below her knee and looked in the glass.";
    const home =
      "When Della reached home her head was covered with tiny, close-lying curls. Please God, make him think I am still pretty.";
    const shop =
      "Where she stopped the sign read Mme. Sofronie. Will you buy my hair? asked Della. Down rippled the brown cascade. Twenty dollars, said Madame.";
    const chain =
      "She was ransacking the stores for Jim's present and found a platinum fob chain simple and chaste in design.";

    const project = createProject({ title: "Magi Rematch" });
    const first = await parsePastedText(
      project.id,
      `${opening}\n\n${home}`,
      fakeCompleteJson({
        proposedScenes: [
          sceneProposal("scene-open", "Della counts", opening, "Chapter 1"),
          sceneProposal("scene-wait", "Della waits", home, "Chapter 1"),
        ],
        proposedEntities: [{ key: "ent-della", kind: "character", name: "Della", description: "A young woman." }],
      }),
    );
    await confirmParseRun(project.id, first.id);
    expect(allSceneTitles(project.id).sort()).toEqual(["Della counts", "Della waits"].sort());

    const second = await parsePastedText(
      project.id,
      `${opening}\n\n${shop}\n\n${chain}\n\n${home}`,
      fakeCompleteJson({
        proposedScenes: [
          sceneProposal("scene-decision", "Della's Decision", opening, "Chapter 1: The Sacrifice"),
          sceneProposal("scene-shop", "At Madame Sofronie's", shop, "Chapter 2: Buying the Gift"),
          sceneProposal("scene-chain", "Finding the Chain", chain, "Chapter 2: Buying the Gift"),
          sceneProposal("scene-gifts", "The Gifts of the Magi", home, "Chapter 3"),
        ],
        proposedEntities: [{ key: "ent-della", kind: "character", name: "Della", description: "A young woman." }],
      }),
    );
    await confirmParseRun(project.id, second.id);

    const titles = allSceneTitles(project.id);
    expect(titles).toContain("Della counts");
    expect(titles).toContain("Della waits");
    expect(titles).toContain("At Madame Sofronie's");
    expect(titles).toContain("Finding the Chain");
    expect(titles).not.toContain("Della's Decision");
    expect(titles).not.toContain("The Gifts of the Magi");
    expect(titles).toHaveLength(4);
  });
});

function sceneProposal(key: string, title: string, script: string, chapterName: string) {
  return {
    key,
    title,
    script,
    intent: title,
    characterNames: ["Della"],
    locationName: null,
    propNames: [],
    costumeNames: [],
    volumeName: "Volume 1",
    chapterName,
  };
}

function allSceneTitles(projectId: string): string[] {
  const titles: string[] = [];
  for (const volume of readTree(projectId).volumes) {
    for (const chapter of volume.chapters) {
      for (const item of chapter.scenes) {
        titles.push(readScene(projectId, volume.id, chapter.id, item.id).title);
      }
    }
  }
  return titles;
}

function harborProposal() {
  return {
    proposedScenes: [
      {
        key: "scene-a",
        title: "Harbor watch",
        script: "Jill waits on the harbor.",
        intent: "Establish Jill at night.",
        characterNames: ["Jill"],
        locationName: "Harbor",
        propNames: ["Lantern"],
        costumeNames: ["Watch coat"],
        volumeName: "Volume 1",
        chapterName: "Harbor night",
      },
    ],
    proposedEntities: [
      { key: "ent-jill", kind: "character" as const, name: "Jill", description: "A night lookout." },
      { key: "ent-harbor", kind: "location" as const, name: "Harbor", description: "Foggy quay." },
      { key: "ent-lantern", kind: "prop" as const, name: "Lantern", description: "Oil lamp." },
      { key: "ent-coat", kind: "costume" as const, name: "Watch coat", description: "Heavy navy coat." },
    ],
  };
}

function fakeCompleteJson(proposal: unknown): CompleteJson {
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
