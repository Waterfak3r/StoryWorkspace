import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { readTree } from "../fs";
import { scriptsCoverSource } from "./preserve-scripts";
import { ingestFixtureStory } from "../test-support/fixture-stories";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;

let workspaceRoot = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-fixture-parse-"));
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

describe("fixture story parse and confirm", () => {
  it("ingests The Last Leaf into scenes, setting, and reusable entities", async () => {
    const { project, confirmed, sourceText } = await ingestFixtureStory("The Last Leaf", "last-leaf");
    const scripts = confirmed.scenes.map((scene) => scene.script);
    expect(confirmed.scenes.length).toBeGreaterThanOrEqual(1);
    expect(scriptsCoverSource(sourceText, scripts)).toBe(true);
    expect(scripts.join(" ").toLowerCase()).toContain("johnsy");

    const names = confirmed.entities.map((entity) => entity.name);
    expect(names).toEqual(expect.arrayContaining(["Sue", "Johnsy", "Behrman", "Greenwich Village studio"]));

    const johnsy = confirmed.entities.find((entity) => entity.name === "Johnsy");
    const studio = confirmed.entities.find((entity) => entity.name === "Greenwich Village studio");
    expect(johnsy?.kind).toBe("character");
    expect(studio?.kind).toBe("location");
    expect(johnsy?.visual.base).toContain("pale");
    expect(confirmed.scenes.some((scene) => scene.characters.includes(johnsy!.id))).toBe(true);
    expect(confirmed.scenes.some((scene) => scene.location === studio!.id)).toBe(true);

    assertPrincipalsNamedInScriptAreLinked(confirmed);

    const behrman = confirmed.entities.find((entity) => entity.name === "Behrman");
    expect(behrman?.kind).toBe("character");
    const behrmanIntro = confirmed.scenes.find((scene) => /Mr\.\s*Behrman|Behrman shouted/i.test(scene.script));
    expect(behrmanIntro).toBeDefined();
    expect(behrmanIntro!.characters).toContain(behrman!.id);

    const recovery = confirmed.scenes.find(
      (scene) => /I want to live/i.test(scene.script) || /last leaf was not real/i.test(scene.script),
    );
    expect(recovery).toBeDefined();
    expect(recovery!.characters).toContain(johnsy!.id);

    const tree = readTree(project.id);
    const chapterTitles = tree.volumes.flatMap((volume) => volume.chapters.map((chapter) => chapter.title));
    expect(chapterTitles.length).toBeGreaterThanOrEqual(2);
    expect(chapterTitles).toEqual(expect.arrayContaining(["Greenwich Village", "The ivy vine", "Behrman's masterpiece"]));
  });

  it("ingests The Tell-Tale Heart into scenes, setting, and reusable entities", async () => {
    const { project, confirmed, sourceText } = await ingestFixtureStory("The Tell-Tale Heart", "tell-tale");
    const scripts = confirmed.scenes.map((scene) => scene.script);
    expect(confirmed.scenes.length).toBeGreaterThanOrEqual(1);
    expect(scriptsCoverSource(sourceText, scripts)).toBe(true);

    const names = confirmed.entities.map((entity) => entity.name);
    expect(names).toEqual(expect.arrayContaining(["Narrator", "Old man", "The old man's chamber"]));

    const narrator = confirmed.entities.find((entity) => entity.name === "Narrator");
    const chamber = confirmed.entities.find((entity) => entity.name === "The old man's chamber");
    expect(narrator?.kind).toBe("character");
    expect(chamber?.kind).toBe("location");
    expect(confirmed.scenes.some((scene) => scene.characters.includes(narrator!.id))).toBe(true);
    expect(confirmed.scenes.some((scene) => scene.location === chamber!.id)).toBe(true);

    assertPrincipalsNamedInScriptAreLinked(confirmed);

    const tree = readTree(project.id);
    const chapterTitles = tree.volumes.flatMap((volume) => volume.chapters.map((chapter) => chapter.title));
    expect(chapterTitles.length).toBeGreaterThanOrEqual(2);
    expect(chapterTitles).toEqual(expect.arrayContaining(["The vulture eye", "The eighth night", "The beating heart"]));
  });
});

function scriptMentionsName(script: string, name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 3) {
    return false;
  }
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z])${escaped}(['’]s)?([^A-Za-z]|$)`, "i").test(script);
}

function assertPrincipalsNamedInScriptAreLinked(confirmed: {
  scenes: Array<{ script: string; characters: string[] }>;
  entities: Array<{ id: string; kind: string; name: string }>;
}) {
  const principals = confirmed.entities.filter((entity) => entity.kind === "character");
  for (const scene of confirmed.scenes) {
    for (const principal of principals) {
      if (scriptMentionsName(scene.script, principal.name)) {
        expect(scene.characters, `${principal.name} named in "${scene.script.slice(0, 48)}"`).toContain(principal.id);
      }
    }
  }
}
