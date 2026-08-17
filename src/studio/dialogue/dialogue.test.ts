import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DEFAULT_COMICS_STYLE_VISUAL, type StudioContextSnapshot, type StudioShot } from "../domain";
import { assembleComicsBook } from "../comics/assemble-pages";
import { compileComicsPagePrompt } from "../generate/compile-prompt";
import { createEntity, createProject, readScene, replaceSceneShots, updateScene } from "../fs";
import { assignDialogueToShots, compilePageLettering, extractAttributedDialogue } from "./index";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;

let workspaceRoot = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-dialogue-"));
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

const SCRIPT = `Sue looks at the vine.

Sue: "The last leaf is still there."

Johnsy said, "I thought it would fall."

The rain keeps coming.`;

const CHARACTERS = [
  { id: "character-01", name: "Sue" },
  { id: "character-02", name: "Johnsy" },
];

describe("dialogue extract, assign, and lettering", () => {
  it("extracts speaker-attributed lines and letters those lines on the page path", () => {
    const lines = extractAttributedDialogue(SCRIPT, CHARACTERS);
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => ({ speaker: line.speaker, text: line.text }))).toEqual([
      { speaker: "Sue", text: "The last leaf is still there." },
      { speaker: "Johnsy", text: "I thought it would fall." },
    ]);
    expect(lines[0]?.speakerId).toBe("character-01");
    expect(lines[1]?.speakerId).toBe("character-02");

    const shots = [
      { id: "shot-01", purpose: "Sue checks the vine", action: "Sue looks at the wall." },
      { id: "shot-02", purpose: "Johnsy answers", action: "Johnsy watches the leaf." },
    ];
    const assigned = assignDialogueToShots(lines, shots);
    expect(assigned[0]?.lines.map((line) => line.speaker)).toEqual(["Sue"]);
    expect(assigned[1]?.lines.map((line) => line.speaker)).toEqual(["Johnsy"]);

    const lettering = compilePageLettering(
      assigned.map((item, panelIndex) => ({
        shotId: item.shotId,
        panelIndex,
        lines: item.lines,
      })),
    );
    expect(lettering.map((balloon) => `${balloon.speaker}:${balloon.text}`)).toEqual([
      "Sue:The last leaf is still there.",
      "Johnsy:I thought it would fall.",
    ]);
    expect(lettering.every((balloon) => balloon.kind === "speech")).toBe(true);

    const compiled = compileComicsPagePrompt(
      [snapshot("shot-01", "Sue looks at the wall."), snapshot("shot-02", "Johnsy watches the leaf.")],
      "",
      [],
      Object.fromEntries(assigned.map((item) => [item.shotId, item.lines])),
    );

    expect(compiled.prompt).toContain("speech: Sue: The last leaf is still there.");
    expect(compiled.prompt).toContain("speech: Johnsy: I thought it would fall.");
    expect(compiled.prompt).toContain("Leave empty space in each panel for the listed speech balloons");
    expect(compiled.prompt).not.toMatch(/speech: Sue looks at the wall/);
    expect(compiled.prompt).not.toMatch(/speech: Johnsy watches the leaf/);
    expect(DEFAULT_COMICS_STYLE_VISUAL).not.toMatch(/no speech balloons/i);
  });

  it("letters assembled pages from script dialogue, not panel captions", () => {
    const project = createProject({ title: "Leaf Talk" });
    const sue = createEntity(project.id, { kind: "character", name: "Sue" });
    const johnsy = createEntity(project.id, { kind: "character", name: "Johnsy" });
    const scene = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      script: SCRIPT,
      characters: [sue.id, johnsy.id],
      expectedUpdatedAt: scene.updatedAt,
    });
    replaceSceneShots(project.id, "volume-01", "chapter-01", "scene-01", [
      still("scene-01", "shot-01", "Sue opens the curtain."),
      still("scene-01", "shot-02", "Johnsy stares at the leaf."),
    ]);

    const book = assembleComicsBook(project.id);
    const page = book.pages[0];
    expect(page).toBeDefined();
    expect(page!.panels.map((panel) => panel.caption)).toEqual([
      "Sue opens the curtain.",
      "Johnsy stares at the leaf.",
    ]);
    expect(page!.lettering.map((balloon) => ({ speaker: balloon.speaker, text: balloon.text }))).toEqual([
      { speaker: "Sue", text: "The last leaf is still there." },
      { speaker: "Johnsy", text: "I thought it would fall." },
    ]);
    expect(page!.panels.flatMap((panel) => panel.speech).map((line) => line.text)).toEqual([
      "The last leaf is still there.",
      "I thought it would fall.",
    ]);
    expect(page!.lettering.some((balloon) => balloon.text === "Sue opens the curtain.")).toBe(false);
  });
});

function still(sceneId: string, id: string, action: string): StudioShot {
  return {
    id,
    scene_id: sceneId,
    purpose: "beat",
    action,
    camera: "wide",
    continuity_from: null,
    status: "success",
    selected_image: `outputs/images/${sceneId}/${id}/run-01.png`,
    updatedAt: new Date().toISOString(),
  };
}

function snapshot(shotId: string, action: string): StudioContextSnapshot {
  return {
    scene: {
      id: "scene-01",
      title: "The last leaf",
      script: SCRIPT,
      intent: "Hope.",
    },
    entities: [
      {
        id: "character-01",
        kind: "character",
        name: "Sue",
        description: "Young woman from Maine.",
        visual: { base: "brown bob", references: [] },
        state: { outfit: "", condition: "" },
      },
      {
        id: "character-02",
        kind: "character",
        name: "Johnsy",
        description: "Frail young woman.",
        visual: { base: "pale face", references: [] },
        state: { outfit: "", condition: "" },
      },
    ],
    style: { id: "default", label: "Default", visual: DEFAULT_COMICS_STYLE_VISUAL },
    intent: "Hope.",
    shot: { id: shotId, purpose: "beat", action, camera: "medium" },
    continuity: { from: null, prior: null },
  };
}
