import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { listEntities, readScene, readTree } from "../fs";
import { completeJson } from "./complete-json";
import { confirmParseRun } from "./confirm-parse-run";
import { parsePastedText } from "./parse-pasted-text";
import { scriptsCoverSource } from "./preserve-scripts";

const LIVE = process.env.MAGI_REPARSE === "1";
const PROJECT_ID = process.env.SOAK_PROJECT ?? "the-gift-of-the-magi";
const WORKSPACE = path.resolve(".data/projects");
const SOURCE = readFileSync(path.resolve(process.cwd(), "test/resource/test_The Gift of the Magi.txt"), "utf8");

describe.skipIf(!LIVE)("reparse Gift of the Magi from the full public-domain text", () => {
  it("confirms the shop visit and gold watch through parsePastedText + confirmParseRun", async () => {
    process.env.STORY_WORKSPACE_ROOT = WORKSPACE;
    delete process.env.STORY_WORKSPACE_DB_PATH;

    const run = await parsePastedText(PROJECT_ID, SOURCE, completeJson);
    expect(run.proposedScenes.some((scene) => /Sofronie|buy my hair/i.test(scene.script))).toBe(true);
    expect(scriptsCoverSource(SOURCE, run.proposedScenes.map((scene) => scene.script))).toBe(true);

    const confirmed = await confirmParseRun(PROJECT_ID, run.id);
    const scripts = confirmed.scenes.map((scene) => scene.script);
    expect(scriptsCoverSource(SOURCE, scripts)).toBe(true);
    expect(scripts.join(" ")).toMatch(/Sofronie/i);
    expect(scripts.join(" ")).toMatch(/buy my hair/i);

    const watch = confirmed.entities.find((entity) => entity.kind === "prop" && /watch/i.test(entity.name));
    expect(watch).toBeTruthy();
    expect(listEntities(PROJECT_ID, "prop").some((entity) => /watch/i.test(entity.name))).toBe(true);

    const tree = readTree(PROJECT_ID);
    const sceneCount = tree.volumes.flatMap((volume) => volume.chapters.flatMap((chapter) => chapter.scenes)).length;
    expect(sceneCount).toBeGreaterThanOrEqual(4);
  }, 180_000);
});

describe.skipIf(process.env.MAGI_FIX_DIALOGUE !== "1")("reconfirm Magi shop and gift dialogue", () => {
  it("re-extracts Madame and Della lines on the shop and gift scenes", async () => {
    process.env.STORY_WORKSPACE_ROOT = WORKSPACE;
    delete process.env.STORY_WORKSPACE_DB_PATH;
    const { confirmSceneDialogue } = await import("../dialogue");
    const shop = await confirmSceneDialogue(PROJECT_ID, "volume-01", "chapter-05", "scene-05");
    expect(shop.dialogue.lines.find((line) => /take yer hat/i.test(line.text))?.speaker).toMatch(/Madame/i);
    expect(shop.dialogue.lines.find((line) => /buy my hair/i.test(line.text))?.speaker).toBe("Della");
    const gifts = await confirmSceneDialogue(PROJECT_ID, "volume-01", "chapter-03", "scene-03");
    expect(gifts.dialogue.lines.find((line) => /sold the watch/i.test(line.text))?.speaker).toBe("Jim");
  }, 180_000);
});

describe.skipIf(process.env.MAGI_ATTACH !== "1")("reattach Magi parse entities", () => {
  it("reconfirms the latest parse run so matched scenes pick up the gold watch", async () => {
    process.env.STORY_WORKSPACE_ROOT = WORKSPACE;
    delete process.env.STORY_WORKSPACE_DB_PATH;
    const confirmed = await confirmParseRun(PROJECT_ID, "parse-02");
    const watch = confirmed.entities.find((entity) => entity.kind === "prop" && /watch/i.test(entity.name));
    expect(watch).toBeTruthy();
    const scene3 = readScene(PROJECT_ID, "volume-01", "chapter-03", "scene-03");
    expect(scene3.props).toContain(watch!.id);
  }, 60_000);
});
