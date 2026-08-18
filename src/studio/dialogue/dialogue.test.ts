import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DEFAULT_COMICS_STYLE_VISUAL, type StudioContextSnapshot, type StudioShot } from "../domain";
import { assembleComicsBook } from "../comics/assemble-pages";
import { compileComicsPagePrompt } from "../generate/compile-prompt";
import { fakeImageAdapter, generateShot } from "../generate";
import { createEntity, createProject, readScene, replaceSceneShots, updateScene } from "../fs";
import { selectComicsLettering } from "../style";
import { timelineEventId } from "../outline/build-timeline";
import {
  assembleProjectDialogue,
  assignDialogueToShots,
  compilePageLettering,
  confirmSceneDialogue,
  extractAttributedDialogue,
  reassignSceneDialogue,
} from "./index";
import { isScriptSubstring } from "./extract-dialogue";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;
const previousUserConfig = process.env.STORY_USER_CONFIG;
const previousAiApiKey = process.env.AI_API_KEY;
const previousAiModel = process.env.AI_MODEL;

const LAST_LEAF = readFileSync(path.join(process.cwd(), "test/resource/test_The Last Leaf.txt"), "utf8");

let workspaceRoot = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-dialogue-"));
  process.env.STORY_WORKSPACE_ROOT = workspaceRoot;
  process.env.STORY_USER_CONFIG = path.join(workspaceRoot, "user-providers.json");
  delete process.env.STORY_WORKSPACE_DB_PATH;
  delete process.env.AI_API_KEY;
  delete process.env.AI_MODEL;
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
  if (previousUserConfig === undefined) {
    delete process.env.STORY_USER_CONFIG;
  } else {
    process.env.STORY_USER_CONFIG = previousUserConfig;
  }
  if (previousAiApiKey === undefined) {
    delete process.env.AI_API_KEY;
  } else {
    process.env.AI_API_KEY = previousAiApiKey;
  }
  if (previousAiModel === undefined) {
    delete process.env.AI_MODEL;
  } else {
    process.env.AI_MODEL = previousAiModel;
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
    expect(lines.every((line) => line.kind === "speech")).toBe(true);

    const shots = [
      { id: "shot-01", purpose: "Sue checks the vine", action: "Sue looks at the wall." },
      { id: "shot-02", purpose: "Johnsy answers", action: "Johnsy watches the leaf." },
    ];
    const assigned = assignDialogueToShots(lines, shots);
    expect(assigned[0]?.lines.map((line) => line.speaker)).toEqual(["Sue"]);
    expect(assigned[1]?.lines.map((line) => line.speaker)).toEqual(["Johnsy"]);

    const magiShots = [
      { id: "shot-01", purpose: "Jim's entrance and bewildered reaction to Della's short hair", action: "Jim stops in the doorway." },
      { id: "shot-02", purpose: "Della pleads", action: "Della explains she sold her hair." },
      { id: "shot-03", purpose: "Reveal the combs", action: "Della unwraps the package of combs." },
      { id: "shot-04", purpose: "Della presenting her gift", action: "Della holds out the watch chain." },
      { id: "shot-05", purpose: "bittersweet resolution", action: "Jim sold his watch and suggests the chops." },
    ];
    const magiLines = [
      { id: "l1", speaker: "Della", speakerId: "character-01", text: "Jim, darling", kind: "speech" as const, eventId: "" },
      { id: "l2", speaker: "Jim", speakerId: "character-02", text: "You've cut off your hair?", kind: "speech" as const, eventId: "" },
      { id: "l3", speaker: "Della", speakerId: "character-01", text: "Isn't it a dandy, Jim?", kind: "speech" as const, eventId: "" },
      { id: "l4", speaker: "Jim", speakerId: "character-02", text: "I sold the watch to get the money to buy your combs.", kind: "speech" as const, eventId: "" },
    ];
    const magiAssigned = assignDialogueToShots(magiLines, magiShots);
    expect(magiAssigned[0]?.lines.map((line) => line.text)).toContain("Jim, darling");
    expect(magiAssigned[2]?.lines.map((line) => line.text).join(" ")).not.toMatch(/cut off your hair/);
    expect(magiAssigned.find((item) => item.lines.some((line) => /cut off your hair/i.test(line.text)))?.shotId).toMatch(
      /shot-0[12]/,
    );
    expect(magiAssigned.find((item) => item.lines.some((line) => /dandy/i.test(line.text)))?.shotId).not.toBe("shot-05");
    expect(magiAssigned.find((item) => item.lines.some((line) => /sold the watch/i.test(line.text)))?.shotId).toBe(
      "shot-05",
    );

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
    expect(lettering.map((balloon) => balloon.anchor)).toEqual(["tl", "tl"]);

    const compiled = compileComicsPagePrompt(
      [snapshot("shot-01", "Sue looks at the wall."), snapshot("shot-02", "Johnsy watches the leaf.")],
      "",
      [],
      Object.fromEntries(assigned.map((item) => [item.shotId, item.lines])),
    );

    expect(compiled.prompt).toContain("speech: Sue: The last leaf is still there.");
    expect(compiled.prompt).toContain("speech: Johnsy: I thought it would fall.");
    expect(compiled.prompt).toContain("Letter ONLY the listed speech:");
    expect(compiled.prompt).not.toContain("Do not letter the words in the pixels");
    expect(compiled.prompt).not.toMatch(/speech: Sue looks at the wall/);
    expect(compiled.prompt).not.toMatch(/speech: Johnsy watches the leaf/);
    expect(DEFAULT_COMICS_STYLE_VISUAL).not.toMatch(/no speech balloons/i);
  });

  it("falls back to a short place caption when the script has no spoken lines", () => {
    const lines = extractAttributedDialogue(
      "In a little district west of Washington Square the streets have run crazy.\n\nSo, to quaint old Greenwich Village, came Sue and Johnsy.",
      CHARACTERS,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.kind).toBe("narration");
    expect(lines[0]?.speakerId).toBeNull();
    expect(["Washington Square", "Greenwich Village"]).toContain(lines[0]?.text);
  });

  it("does not letter or generate speech from an unprocessed quoted script", async () => {
    const project = seedQuotedScene();
    const before = assembleProjectDialogue(project.id);
    expect(before.lineCount).toBe(0);
    expect(before.scenes[0]?.shots.every((shot) => shot.lines.length === 0)).toBe(true);

    const generated = await generateShot(
      project.id,
      "volume-01",
      "chapter-01",
      "scene-01",
      "shot-01",
      { mode: "generate" },
      fakeImageAdapter,
    );
    expect(generated.compiled.prompt).not.toMatch(/speech:/);

    const book = assembleComicsBook(project.id);
    expect(book.pages[0]?.lettering).toEqual([]);
    expect(book.pages[0]?.panels.flatMap((panel) => panel.speech)).toEqual([]);
  });

  it("confirms speaker entity ids and keeps generate/lettering on confirmed text after the script changes", async () => {
    const project = seedQuotedScene();
    const confirmed = await confirmSceneDialogue(project.id, "volume-01", "chapter-01", "scene-01");
    expect(confirmed.dialogue.status).toBe("confirmed");
    expect(confirmed.dialogue.lines.map((line) => line.speakerId)).toEqual([
      expect.stringMatching(/^character-/),
      expect.stringMatching(/^character-/),
    ]);
    const eventId = timelineEventId({
      volumeId: "volume-01",
      chapterId: "chapter-01",
      sceneId: "scene-01",
    });
    expect(confirmed.dialogue.lines.every((line) => line.eventId === eventId)).toBe(true);
    const sue = confirmed.dialogue.lines.find((line) => line.speaker === "Sue");
    const johnsy = confirmed.dialogue.lines.find((line) => line.speaker === "Johnsy");
    expect(sue?.speakerId).toBeTruthy();
    expect(johnsy?.speakerId).toBeTruthy();
    expect(sue?.speakerId).not.toBe(johnsy?.speakerId);

    const assembled = assembleProjectDialogue(project.id);
    expect(assembled.lineCount).toBe(2);
    expect(assembled.scenes[0]?.eventId).toBe(eventId);
    expect(assembled.scenes[0]?.shots[0]?.lines.map((line) => `${line.speaker}:${line.text}`)).toEqual([
      "Sue:The last leaf is still there.",
    ]);
    expect(assembled.scenes[0]?.shots[1]?.lines.map((line) => `${line.speaker}:${line.text}`)).toEqual([
      "Johnsy:I thought it would fall.",
    ]);
    expect(assembled.scenes[0]?.shots[0]?.lines[0]?.kind).toBe("speech");
    expect(assembled.scenes[0]?.shots[0]?.lines[0]?.eventId).toBe(eventId);

    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      script: 'Sue: "The ivy is gone."\nJohnsy: "Then I will die."',
      expectedUpdatedAt: readScene(project.id, "volume-01", "chapter-01", "scene-01").updatedAt,
    });

    const generated = await generateShot(
      project.id,
      "volume-01",
      "chapter-01",
      "scene-01",
      "shot-01",
      { mode: "generate" },
      fakeImageAdapter,
    );
    expect(generated.compiled.prompt).toContain("speech: Sue: The last leaf is still there.");
    expect(generated.compiled.prompt).toContain("speech: Johnsy: I thought it would fall.");
    expect(generated.compiled.prompt).not.toContain("The ivy is gone.");
    expect(generated.compiled.prompt).not.toContain("Then I will die.");

    const book = assembleComicsBook(project.id);
    expect(book.pages[0]?.lettering.map((balloon) => `${balloon.speaker}:${balloon.text}`)).toEqual([
      "Sue:The last leaf is still there.",
      "Johnsy:I thought it would fall.",
    ]);
    expect(book.pages[0]?.lettering.some((balloon) => balloon.text === "Sue looks at the wall.")).toBe(false);
  });

  it("extracts Sue and Johnsy from Last Leaf original wording", async () => {
    const project = seedOriginalScene(LAST_LEAF, ["Sue", "Johnsy"]);
    const confirmed = await confirmSceneDialogue(project.id, "volume-01", "chapter-01", "scene-01");
    const sue = confirmed.dialogue.lines.filter((line) => line.speaker === "Sue");
    const johnsy = confirmed.dialogue.lines.filter((line) => line.speaker === "Johnsy");
    expect(sue.length).toBeGreaterThan(0);
    expect(johnsy.length).toBeGreaterThan(0);
    expect(sue.every((line) => line.speakerId?.startsWith("character-"))).toBe(true);
    expect(johnsy.every((line) => line.speakerId?.startsWith("character-"))).toBe(true);
    expect(sue[0]?.speakerId).not.toBe(johnsy[0]?.speakerId);
    expect(sue.every((line) => line.kind === "speech")).toBe(true);
    expect(johnsy.every((line) => line.kind === "speech")).toBe(true);
    expect(
      sue.some((line) => /don’t be silly|doesn’t want to live|old ivy leaf/i.test(line.text)),
    ).toBe(true);
    expect(johnsy.some((line) => /last one fall|leaves|it is the last one|twelve/i.test(line.text))).toBe(true);
    expect(confirmed.dialogue.lines.every((line) => isScriptSubstring(line.text, LAST_LEAF))).toBe(true);
    expect(
      confirmed.dialogue.lines.every(
        (line) =>
          line.eventId ===
          timelineEventId({ volumeId: "volume-01", chapterId: "chapter-01", sceneId: "scene-01" }),
      ),
    ).toBe(true);
  });

  it("keeps Johnsy counting Twelve through Seven instead of a lone Leaves fragment", () => {
    const script = `Johnsy was counting.

“Twelve,” she whispered.

Sue looked outside.

“What are you counting?”

“Leaves,” answered Johnsy.

“Leaves? On that old ivy vine?”

“Yes. When the last one falls, I must go too.”

She continued counting.

“Eleven.”

A few moments later:

“Ten.”

Then:

“Nine.”

“Seven,” she whispered.`;
    const lines = extractAttributedDialogue(script, CHARACTERS);
    const texts = lines.map((line) => `${line.speaker}:${line.text}`);
    expect(texts).toEqual(
      expect.arrayContaining([
        "Johnsy:Twelve",
        "Sue:What are you counting?",
        "Johnsy:Leaves",
        "Sue:Leaves? On that old ivy vine?",
        "Johnsy:Yes. When the last one falls, I must go too.",
        "Johnsy:Eleven",
        "Johnsy:Ten",
        "Johnsy:Nine",
        "Johnsy:Seven",
      ]),
    );
    expect(texts.some((line) => line === "Johnsy:Leaves" && !line.includes("Twelve"))).toBe(true);
    expect(lines.filter((line) => /twelve|eleven|ten|nine|seven/i.test(line.text)).every((line) => line.speaker === "Johnsy")).toBe(true);
    expect(lines.find((line) => line.text === "Eleven")?.speaker).toBe("Johnsy");
    expect(lines.find((line) => line.text === "Seven")?.speaker).toBe("Johnsy");
  });

  it("keeps Madame Sofronie on said Madame and the following hat command", () => {
    const script = [
      "Where she stopped the sign read: “Mme. Sofronie. Hair Goods of All Kinds.”",
      "“Will you buy my hair?” asked Della.",
      "“I buy hair,” said Madame. “Take yer hat off and let’s have a sight at the looks of it.”",
      "“Twenty dollars,” said Madame.",
      "“Give it to me quick,” said Della.",
    ].join("\n");
    const lines = extractAttributedDialogue(script, [
      { id: "character-01", name: "Della" },
      { id: "character-03", name: "Madame Sofronie" },
    ]);
    expect(lines.find((line) => /buy my hair/i.test(line.text))?.speaker).toBe("Della");
    expect(lines.find((line) => /^I buy hair/i.test(line.text))?.speaker).toBe("Madame Sofronie");
    expect(lines.find((line) => /take yer hat/i.test(line.text))?.speaker).toBe("Madame Sofronie");
    expect(lines.find((line) => /twenty dollars/i.test(line.text))?.speaker).toBe("Madame Sofronie");
    expect(lines.find((line) => /give it to me quick/i.test(line.text))?.speaker).toBe("Della");
    expect(lines.some((line) => /hardly looked/i.test(line.text) || /where she stopped/i.test(line.speaker))).toBe(false);
  });

  it("does not treat a mailbox nameplate as spoken dialogue", () => {
    const lines = extractAttributedDialogue(
      'Also appertaining thereunto was a card bearing the name “Mr. James Dillingham Young.”',
      [
        { id: "character-01", name: "Della" },
        { id: "character-02", name: "Jim" },
      ],
    );
    expect(lines.filter((line) => line.kind === "speech").some((line) => /dillingham|james/i.test(line.text))).toBe(
      false,
    );
    expect(lines.some((line) => /mr\.?\s*james dillingham/i.test(line.text))).toBe(false);
  });

  it("keeps Gift of the Magi vocatives and he said continuations on the right speaker", () => {
    const script = [
      'Della wriggled off the table and went for him.',
      '“Jim, darling,” she cried, “don’t look at me that way.”',
      '“You’ve cut off your hair?” asked Jim, laboriously.',
      '“Cut it off and sold it,” said Della.',
      '“Don’t make any mistake, Dell,” he said, “about me. I don’t think there’s anything in the way of a haircut that could make me like my girl any less.”',
      'She held it out to him. “Isn’t it a dandy, Jim? I hunted all over town to find it.”',
      '“Dell,” said he, “let’s put our Christmas presents away and keep ’em a while. I sold the watch to get the money to buy your combs.”',
    ].join("\n");
    const lines = extractAttributedDialogue(script, [
      { id: "character-01", name: "Della" },
      { id: "character-02", name: "Jim" },
    ]);
    const has = (needle: string) => lines.find((line) => line.text.toLowerCase().includes(needle.toLowerCase()));
    expect(has("Jim, darling")?.speaker).toBe("Della");
    expect(has("don’t look at me")?.speaker ?? has("don't look at me")?.speaker).toBe("Della");
    expect(has("You’ve cut off")?.speaker ?? has("You've cut off")?.speaker).toBe("Jim");
    expect(has("Cut it off")?.speaker).toBe("Della");
    expect(has("Don’t make any mistake")?.speaker ?? has("Don't make any mistake")?.speaker).toBe("Jim");
    expect(has("about me")?.speaker).toBe("Jim");
    expect(has("Isn’t it a dandy")?.speaker ?? has("Isn't it a dandy")?.speaker).toBe("Della");
    expect(has("let’s put our Christmas")?.speaker ?? has("let's put our Christmas")?.speaker).toBe("Jim");
    expect(has("I sold the watch")?.speaker ?? lines.find((line) => /sold the watch/i.test(line.text))?.speaker).toBe(
      "Jim",
    );
    expect(
      extractAttributedDialogue('Della held it out. “Shall I put the chops on, Jim?”', [
        { id: "character-01", name: "Della" },
        { id: "character-02", name: "Jim" },
      ]).find((line) => /chops/i.test(line.text))?.speaker,
    ).toBe("Della");
  });

  it("keeps a split Magi aside as one spoken line so lettering cannot invent the rest", () => {
    const script =
      "“If Jim doesn’t kill me,” she said to herself, “before he takes a second look at me, he’ll say I look like a Coney Island chorus girl. But what could I do—oh! what could I do with a dollar and eighty-seven cents?”";
    const lines = extractAttributedDialogue(script, [{ id: "character-01", name: "Della" }]);
    const speech = lines.filter((line) => line.kind === "speech");
    expect(speech).toHaveLength(1);
    expect(speech[0]?.speaker).toBe("Della");
    expect(speech[0]?.text).toMatch(/kill me/i);
    expect(speech[0]?.text).toMatch(/chorus girl/i);
    expect(speech[0]?.text).toMatch(/eighty-seven/i);
  });

  it("assigns shop lines to the inquiry, inspect, and pay shots, not the street arrival", () => {
    const shopShots = [
      {
        id: "shot-01",
        purpose: "Establish location and Della's hurried arrival",
        action:
          "Della pauses beneath the street-level sign reading 'Mme. Sofronie. Hair Goods of All Kinds,' then dashes up the flight of stairs, pausing breathlessly at the landing to collect herself.",
      },
      {
        id: "shot-02",
        purpose: "Introduce Madame Sofronie and deliver Della's inquiry",
        action:
          "Della enters the shop and faces Madame, a large, excessively pale, and chilly woman. Della asks, 'Will you buy my hair?'",
      },
      {
        id: "shot-03",
        purpose: "Show Madame's command and the dramatic release of Della's hair",
        action:
          "Madame responds flatly, 'I buy hair. Take yer hat off and let’s have a sight at the looks of it.' Della removes her hat, letting her brown cascade of hair ripple down.",
      },
      {
        id: "shot-04",
        purpose: "Weigh the hair and finalize the transaction",
        action:
          "Madame lifts the thick mass of hair with a practised hand, declaring, 'Twenty dollars.' Della urgently replies, 'Give it to me quick.'",
      },
    ];
    const shopLines = [
      { id: "l1", speaker: "Della", speakerId: "character-01", text: "Will you buy my hair?", kind: "speech" as const, eventId: "" },
      { id: "l2", speaker: "Madame Sofronie", speakerId: "character-03", text: "I buy hair", kind: "speech" as const, eventId: "" },
      {
        id: "l3",
        speaker: "Madame Sofronie",
        speakerId: "character-03",
        text: "Take yer hat off and let’s have a sight at the looks of it.",
        kind: "speech" as const,
        eventId: "",
      },
      { id: "l4", speaker: "Madame Sofronie", speakerId: "character-03", text: "Twenty dollars", kind: "speech" as const, eventId: "" },
      { id: "l5", speaker: "Della", speakerId: "character-01", text: "Give it to me quick", kind: "speech" as const, eventId: "" },
    ];
    const assigned = assignDialogueToShots(shopLines, shopShots);
    expect(assigned.find((item) => item.shotId === "shot-02")?.lines.map((line) => line.text)).toEqual(
      expect.arrayContaining(["Will you buy my hair?", "I buy hair"]),
    );
    expect(assigned.find((item) => item.shotId === "shot-01")?.lines.some((line) => /buy my hair/i.test(line.text))).toBe(
      false,
    );
    expect(assigned.find((item) => item.shotId === "shot-03")?.lines.map((line) => line.text).join(" ")).toMatch(
      /take yer hat off/i,
    );
    expect(assigned.find((item) => item.shotId === "shot-04")?.lines.map((line) => line.text)).toEqual(
      expect.arrayContaining(["Twenty dollars", "Give it to me quick"]),
    );
  });

  it("assigns the waiting prayer to the door beat, not the mirror", () => {
    const script = [
      "Within forty minutes her head was covered with tiny, close-lying curls.",
      "“If Jim doesn’t kill me,” she said to herself, “before he takes a second look at me, he’ll say I look like a Coney Island chorus girl.”",
      "She sat on the corner of the table near the door and whispered: “Please God, make him think I am still pretty.”",
    ].join("\n");
    const lines = extractAttributedDialogue(script, [{ id: "character-01", name: "Della" }]);
    const assigned = assignDialogueToShots(lines, [
      { id: "shot-01", purpose: "Curl the cropped hair", action: "Della uses curling irons on her shorn hair." },
      { id: "shot-02", purpose: "Schoolboy curls", action: "Della studies her close-lying curls in the mirror." },
      { id: "shot-03", purpose: "Supper ready", action: "The frying-pan waits on the stove." },
      { id: "shot-04", purpose: "Wait and prayer", action: "Della sits at the table near the door and whispers a prayer to stay pretty." },
    ]);
    expect(assigned.find((item) => item.shotId === "shot-04")?.lines.some((line) => /still pretty/i.test(line.text))).toBe(
      true,
    );
    expect(assigned.find((item) => item.shotId === "shot-02")?.lines.some((line) => /still pretty/i.test(line.text))).toBe(
      false,
    );
  });

  it("attributes she said to the unique female character when Johnsy is present", () => {
    const lines = extractAttributedDialogue("“I want to live,” she said.", [
      { id: "character-02", name: "Johnsy" },
      { id: "character-03", name: "Behrman" },
    ]);
    expect(lines).toEqual([
      expect.objectContaining({
        speaker: "Johnsy",
        speakerId: "character-02",
        text: "I want to live",
        kind: "speech",
      }),
    ]);
  });

  it("keeps at most five speech lines and one narration per shot", async () => {
    const project = seedQuotedScene();
    const scene = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      script: `Sue: "One."
Sue: "Two."
Sue: "Three."
旁白: 夜雨。
旁白: 更深。
旁白: 拂晓。`,
      expectedUpdatedAt: scene.updatedAt,
    });

    const confirmed = await confirmSceneDialogue(project.id, "volume-01", "chapter-01", "scene-01");
    const byShot = new Map<string, { speech: number; narration: number }>();
    for (const line of confirmed.dialogue.lines) {
      if (!line.shotId) {
        continue;
      }
      const bucket = byShot.get(line.shotId) ?? { speech: 0, narration: 0 };
      if (line.kind === "narration") {
        bucket.narration += 1;
      } else {
        bucket.speech += 1;
      }
      byShot.set(line.shotId, bucket);
    }
    for (const counts of byShot.values()) {
      expect(counts.speech).toBeLessThanOrEqual(5);
      expect(counts.narration).toBeLessThanOrEqual(1);
    }
    expect(confirmed.dialogue.lines.some((line) => line.kind === "narration" && line.speakerId === null)).toBe(
      true,
    );
    expect(confirmed.dialogue.lines.some((line) => line.shotId === null)).toBe(true);

    const assembled = assembleProjectDialogue(project.id);
    const lettering = compilePageLettering(
      assembled.scenes[0]!.shots.map((shot, panelIndex) => ({
        shotId: shot.shotId,
        panelIndex,
        lines: shot.lines,
      })),
    );
    expect(lettering.some((balloon) => balloon.kind === "narration" && balloon.anchor === "bl")).toBe(true);
  });

  it("reassigns leftover Magi confrontation and gift lines onto matching shots", () => {
    const project = seedQuotedScene();
    const scene = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    const della = scene.characters[0]!;
    const jim = scene.characters[1]!;
    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      script: MAGI_SCENE_03_SCRIPT,
      expectedUpdatedAt: scene.updatedAt,
    });
    replaceSceneShots(project.id, "volume-01", "chapter-01", "scene-01", MAGI_SCENE_03_SHOTS);
    const leftover = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      dialogue: {
        status: "confirmed",
        lines: [
          speechLine("line-01", "Della", della, "Jim, darling", "shot-01"),
          speechLine("line-02", "Della", della, "don’t look at me that way. I had my hair cut off and sold because I couldn’t have lived through Christmas without giving you a present.", "shot-01"),
          speechLine("line-03", "Jim", jim, "You’ve cut off your hair?", "shot-01"),
          speechLine("line-04", "Della", della, "Cut it off and sold it", null),
          speechLine("line-05", "Della", della, "Don’t you like me just as well, anyhow? I’m me without my hair, ain’t I?", null),
          speechLine("line-06", "Jim", jim, "You say your hair is gone?", null),
          speechLine("line-07", "Della", della, "You needn’t look for it", null),
          speechLine("line-08", "Della", della, "It’s sold, I tell you—sold and gone, too. It’s Christmas Eve, boy. Be good to me, for it went for you. Maybe the hairs of my head were numbered", null),
          speechLine("line-09", "Della", della, "but nobody could ever count my love for you. Shall I put the chops on, Jim?", "shot-05"),
          speechLine("line-10", "Jim", jim, "Don’t make any mistake, Dell", "shot-05"),
          speechLine("line-11", "Jim", jim, "about me. I don’t think there’s anything in the way of a haircut or a shave or a shampoo that could make me like my girl any less. But if you’ll unwrap that package you may see why you had me going a while at first.", "shot-03"),
          speechLine("line-12", "Della", della, "My hair grows so fast, Jim!", null),
          speechLine("line-13", "Della", della, "Oh, oh!", null),
          speechLine("line-14", "Della", della, "Isn’t it a dandy, Jim? I hunted all over town to find it. You’ll have to look at the time a hundred times a day now. Give me your watch. I want to see how it looks on it.", "shot-04"),
          speechLine("line-15", "Jim", jim, "Dell", "shot-04"),
          speechLine("line-16", "Jim", jim, "let’s put our Christmas presents away and keep ’em a while. They’re too nice to use just at present. I sold the watch to get the money to buy your combs. And now suppose you put the chops on.", "shot-05"),
        ],
        confirmedAt: leftover.updatedAt,
      },
      expectedUpdatedAt: leftover.updatedAt,
    });

    const reassigned = reassignSceneDialogue(project.id, "volume-01", "chapter-01", "scene-01");
    const plot = [
      "Jim, darling",
      "You’ve cut off your hair?",
      "Cut it off and sold it",
      "You say your hair is gone?",
      "Shall I put the chops on, Jim?",
      "Don’t make any mistake, Dell",
      "My hair grows so fast, Jim!",
      "Oh, oh!",
      "Isn’t it a dandy, Jim?",
      "I sold the watch",
    ];
    for (const needle of plot) {
      const match = reassigned.dialogue.lines.find((item) => item.text.includes(needle.replace(/\?$/, "")) || item.text.includes(needle));
      expect(match?.shotId, needle).toBeTruthy();
    }
    expect(
      reassigned.dialogue.lines
        .filter((line) =>
          /cut off|darling|hair is gone|needn['’]?t look|sold it|shall i put the chops|grows so fast|dandy|sold the watch|don’t make any mistake|oh, oh/i.test(
            line.text,
          ),
        )
        .every((line) => line.shotId),
    ).toBe(true);
    expect(reassigned.dialogue.lines.find((line) => line.text.startsWith("Jim, darling"))?.speaker).toBe("Della");
    expect(reassigned.dialogue.lines.find((line) => /cut off your hair/i.test(line.text))?.speaker).toBe("Jim");
    expect(reassigned.dialogue.lines.find((line) => /dandy/i.test(line.text))?.speaker).toBe("Della");
    expect(reassigned.dialogue.lines.find((line) => /sold the watch/i.test(line.text))?.speaker).toBe("Jim");
    const hairShot = Number(
      (reassigned.dialogue.lines.find((line) => /cut off your hair/i.test(line.text))?.shotId ?? "shot-99").replace(
        "shot-",
        "",
      ),
    );
    const combShot = Number(
      (reassigned.dialogue.lines.find((line) => /unwrap that package/i.test(line.text))?.shotId ?? "shot-00").replace(
        "shot-",
        "",
      ),
    );
    const chainShot = Number(
      (reassigned.dialogue.lines.find((line) => /dandy/i.test(line.text))?.shotId ?? "shot-00").replace("shot-", ""),
    );
    const watchShot = Number(
      (reassigned.dialogue.lines.find((line) => /sold the watch/i.test(line.text))?.shotId ?? "shot-00").replace(
        "shot-",
        "",
      ),
    );
    expect(hairShot).toBeLessThanOrEqual(2);
    expect(watchShot).toBeGreaterThanOrEqual(hairShot);
    expect(reassigned.dialogue.lines.find((line) => /sold the watch/i.test(line.text))?.shotId).toMatch(/shot-0[25]/);
    expect(reassigned.dialogue.lines.find((line) => /shall i put the chops/i.test(line.text))?.shotId).toMatch(
      /shot-0[125]/,
    );
    expect(reassigned.dialogue.lines.find((line) => /don’t make any mistake/i.test(line.text))?.shotId).toBeTruthy();
    expect(reassigned.dialogue.lines.find((line) => /^Dell$/i.test(line.text))?.shotId).toBeTruthy();
  });

  it("uses confirmed original lines for generate after the script changes", async () => {
    const excerpt = [
      "“Johnsy, don’t be silly,” said Sue. “What does an old ivy leaf have to do with you getting well?”",
      "",
      "“I want to see the last one fall,” said Johnsy. “Then I will go too.”",
    ].join("\n");
    const project = seedOriginalScene(excerpt, ["Sue", "Johnsy"]);
    const confirmed = await confirmSceneDialogue(project.id, "volume-01", "chapter-01", "scene-01");
    const confirmedTexts = confirmed.dialogue.lines.map((line) => line.text);
    expect(confirmedTexts.some((text) => text.includes("don’t be silly"))).toBe(true);
    expect(confirmedTexts.some((text) => text.includes("last one fall"))).toBe(true);

    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      script: 'Sue: "The ivy is gone."\nJohnsy: "Then I will die."',
      expectedUpdatedAt: readScene(project.id, "volume-01", "chapter-01", "scene-01").updatedAt,
    });

    const generated = await generateShot(
      project.id,
      "volume-01",
      "chapter-01",
      "scene-01",
      "shot-01",
      { mode: "generate" },
      fakeImageAdapter,
    );
    expect(generated.compiled.prompt).toContain("don’t be silly");
    expect(generated.compiled.prompt).toContain("last one fall");
    expect(generated.compiled.prompt).not.toContain("The ivy is gone.");
    expect(generated.compiled.prompt).not.toContain(excerpt);
  });

  it("forks generate prompts for model and overlay lettering", async () => {
    const project = seedQuotedScene();
    await confirmSceneDialogue(project.id, "volume-01", "chapter-01", "scene-01");

    const modeled = await generateShot(
      project.id,
      "volume-01",
      "chapter-01",
      "scene-01",
      "shot-01",
      { mode: "generate" },
      fakeImageAdapter,
    );
    expect(modeled.compiled.prompt).toContain("speech: Sue: The last leaf is still there.");
    expect(modeled.compiled.prompt).toContain("Letter ONLY the listed speech:");
    expect(modeled.compiled.prompt).not.toContain("Do not letter the words in the pixels");

    selectComicsLettering(project.id, "overlay");
    const overlaid = await generateShot(
      project.id,
      "volume-01",
      "chapter-01",
      "scene-01",
      "shot-01",
      { mode: "generate" },
      fakeImageAdapter,
    );
    expect(overlaid.compiled.prompt).toContain("speech: Sue: The last leaf is still there.");
    expect(overlaid.compiled.prompt).toContain("Do not letter the words in the pixels");
    expect(overlaid.compiled.prompt).not.toContain(SCRIPT);
  });

  it("defaults missing dialogue fields to unprocessed speech without breaking legacy lines", () => {
    const project = seedQuotedScene();
    const scene = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    const sue = scene.characters[0]!;
    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      dialogue: {
        status: "confirmed",
        lines: [
          {
            id: "line-01",
            speaker: "Sue",
            speakerId: sue,
            text: "The last leaf is still there.",
            shotId: "shot-01",
          },
        ],
      },
      expectedUpdatedAt: scene.updatedAt,
    });
    const loaded = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    expect(loaded.dialogue.lines[0]?.kind).toBe("speech");
    expect(loaded.dialogue.lines[0]?.eventId).toBe("");
    expect(loaded.dialogue.status).toBe("confirmed");
  });
});

function seedQuotedScene() {
  return seedOriginalScene(SCRIPT, ["Sue", "Johnsy"]);
}

function seedOriginalScene(script: string, names: readonly string[]) {
  const project = createProject({ title: "Leaf Talk" });
  const ids = names.map((name) => createEntity(project.id, { kind: "character", name }).id);
  const scene = readScene(project.id, "volume-01", "chapter-01", "scene-01");
  updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
    script,
    characters: ids,
    expectedUpdatedAt: scene.updatedAt,
  });
  replaceSceneShots(project.id, "volume-01", "chapter-01", "scene-01", [
    still("scene-01", "shot-01", "Sue looks at the wall."),
    still("scene-01", "shot-02", "Johnsy watches the leaf."),
  ]);
  return project;
}

const MAGI_SCENE_03_SCRIPT = `Della wriggled off the table and went for him.
“Jim, darling,” she cried, “don’t look at me that way.”
“You’ve cut off your hair?” asked Jim.
“Cut it off and sold it,” said Della.
“Don’t make any mistake, Dell,” he said, “about me.”
“Isn’t it a dandy, Jim?”
“Dell,” said he, “I sold the watch to get the money to buy your combs.”`;

const MAGI_SCENE_03_SHOTS: StudioShot[] = [
  magiShot("shot-01", "Jim's entrance and bewildered reaction to Della's short hair", "Jim stops in the doorway and stares."),
  magiShot("shot-02", "Della pleads", "Della explains she sold her hair."),
  magiShot("shot-03", "Reveal the combs", "Della unwraps the package of combs."),
  magiShot("shot-04", "Della presenting her gift", "Della holds out the watch chain on her palm."),
  magiShot("shot-05", "bittersweet resolution", "Jim sold his watch and leans on the couch."),
];

function magiShot(id: string, purpose: string, action: string): StudioShot {
  return {
    id,
    scene_id: "scene-01",
    purpose,
    action,
    camera: "medium",
    continuity_from: null,
    status: "pending",
    selected_image: null,
    pageId: "",
    updatedAt: new Date().toISOString(),
  };
}

function speechLine(
  id: string,
  speaker: string,
  speakerId: string,
  text: string,
  shotId: string | null,
) {
  return {
    id,
    speaker,
    speakerId,
    text,
    shotId,
    kind: "speech" as const,
    eventId: "volume-01-chapter-01-scene-01",
  };
}

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
    pageId: "",
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
        visual: { base: "brown bob", references: [], spatial: "" },
        state: { outfit: "", condition: "" },
      },
      {
        id: "character-02",
        kind: "character",
        name: "Johnsy",
        description: "Frail young woman.",
        visual: { base: "pale face", references: [], spatial: "" },
        state: { outfit: "", condition: "" },
      },
    ],
    style: { id: "default", label: "Default", visual: DEFAULT_COMICS_STYLE_VISUAL },
    intent: "Hope.",
    shot: { id: shotId, purpose: "beat", action, camera: "medium" },
    continuity: { from: null, prior: null },
    storyPosition: { events: [] },
  };
}
