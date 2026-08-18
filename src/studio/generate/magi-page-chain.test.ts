import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { planScenePages } from "../comics/plan-pages";
import { resolveContext } from "../context";
import { confirmSceneDialogue, confirmedSpeechByShot } from "../dialogue";
import {
  createChapter,
  createEntity,
  createProject,
  createScene,
  getWorkspaceRoot,
  readScene,
  readStyle,
  readTree,
  replaceSceneShots,
  updateEntity,
  updateScene,
  writeContentState,
} from "../fs";
import { writeInferredSceneStates } from "../state/infer-scene-state";
import { startWorkflow } from "../workflow/start-workflow";
import { compileComicsPagePrompt } from "./compile-prompt";
import { fakeImageAdapter } from "./fake-image-adapter";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;
const previousUserConfig = process.env.STORY_USER_CONFIG;
const previousAiApiKey = process.env.AI_API_KEY;
const previousAiModel = process.env.AI_MODEL;
const previousImageApiKey = process.env.IMAGE_API_KEY;

let workspaceRoot = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-magi-chain-"));
  process.env.STORY_WORKSPACE_ROOT = workspaceRoot;
  process.env.STORY_USER_CONFIG = path.join(workspaceRoot, "user-providers.json");
  delete process.env.STORY_WORKSPACE_DB_PATH;
  delete process.env.AI_API_KEY;
  delete process.env.AI_MODEL;
  delete process.env.IMAGE_API_KEY;
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
  restoreEnv("STORY_WORKSPACE_ROOT", previousWorkspaceRoot);
  restoreEnv("STORY_WORKSPACE_DB_PATH", previousDbPath);
  restoreEnv("STORY_USER_CONFIG", previousUserConfig);
  restoreEnv("AI_API_KEY", previousAiApiKey);
  restoreEnv("AI_MODEL", previousAiModel);
  restoreEnv("IMAGE_API_KEY", previousImageApiKey);
});

function restoreEnv(name: string, previous: string | undefined) {
  if (previous === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}

describe("Magi page chain invariants", () => {
  it("keeps first-stable long hair, as-of short curls, utterers, and beat order through infer/confirm/compile/start", async () => {
    const seeded = seedMagiProject();
    writeInferredSceneStates(seeded.projectId);
    expect(readScene(seeded.projectId, "volume-01", "chapter-01", "scene-01")).toBeTruthy();

    const first = await startWorkflow(seeded.projectId, { adapter: fakeImageAdapter });
    expect(first.generated.sort()).toEqual(["page-01-01", "page-01-02", "page-02-01", "page-03-01", "page-03-02"]);
    const second = await startWorkflow(seeded.projectId, { adapter: fakeImageAdapter });
    expect(second.generated).toEqual([]);
    expect(second.skipped.sort()).toEqual(first.generated.sort());

    const dumps = dumpProjectPages(seeded.projectId);
    const uncut = dumps.find((page) => page.pageId === "page-01-02") ?? dumps.find((page) => page.pageId === "page-01-01")!;
    const cutWait = dumps.find((page) => page.pageId === "page-02-01")!;
    const confront = dumps.find((page) => page.pageId === "page-03-01")!;
    const gifts = dumps.find((page) => page.pageId === "page-03-02")!;

    expect(uncut.dellaIdentity).toMatch(/knee-length brown hair/i);
    expect(uncut.dellaCondition).toMatch(/knee-length brown hair/i);
    expect(uncut.prompt).toMatch(/knee-length|full length|long hair/i);
    expect(uncut.prompt).not.toMatch(/close-lying curls/i);

    expect(cutWait.dellaIdentity).toMatch(/knee-length brown hair/i);
    expect(cutWait.dellaCondition).toMatch(/shorn|curl/i);
    expect(cutWait.prompt).toMatch(/shorn|close-lying curls|curl/i);
    expect(cutWait.prompt).not.toMatch(/knee-length brown hair/i);
    const prayerShot = cutWait.shots.find((shot) => /prayer|door/i.test(`${shot.purpose} ${shot.action}`));
    expect(prayerShot?.lines.some((line) => /still pretty/i.test(line.text))).toBe(true);
    expect(
      cutWait.shots
        .filter((shot) => /mirror|schoolboy/i.test(`${shot.purpose} ${shot.action}`))
        .every((shot) => shot.lines.every((line) => !/still pretty/i.test(line.text))),
    ).toBe(true);

    expect(confront.dellaIdentity).toMatch(/knee-length brown hair/i);
    expect(confront.dellaCondition).toMatch(/curl/i);
    expect(confront.prompt).toMatch(/close-lying curls/i);
    expect(confront.prompt).not.toMatch(/knee-length brown hair/i);
    expect(confront.prompt).toMatch(/speech: Della: Jim, darling/);
    expect(confront.prompt).toMatch(/speech: Jim: You’ve cut off your hair\?|speech: Jim: You've cut off your hair\?/);
    expect(confront.actions.join(" ")).toMatch(/doorway|stare|plead|sold her hair/i);
    expect(confront.actions.join(" ")).toMatch(/comb|package/i);
    expect(actionIndex(confront.actions, /doorway|stare/i)).toBeLessThan(actionIndex(confront.actions, /comb|package/i));

    expect(gifts.prompt).toMatch(/dandy/i);
    expect(gifts.prompt).toMatch(/speech: Della:/);
    expect(gifts.prompt).toMatch(/sold (his |the )?watch/i);
    expect(gifts.prompt).toMatch(/speech: Jim:/);
    expect(actionIndex(gifts.actions, /chain|palm/i)).toBeLessThan(actionIndex(gifts.actions, /sold (his |the )?watch/i));

    const scene03 = readScene(seeded.projectId, "volume-01", "chapter-03", "scene-03");
    const leftover = scene03.dialogue.lines.filter(
      (line) =>
        line.shotId === null &&
        /cut off|hair is gone|needn['’]?t look|darling|dandy|sold the watch|grows so fast/i.test(line.text),
    );
    expect(leftover).toEqual([]);

    const currentDir = path.join(getWorkspaceRoot(), seeded.projectId, "outputs", "comics", "current");
    for (const pageId of ["page-01-01", "page-01-02", "page-02-01", "page-03-01", "page-03-02"]) {
      expect(existsSync(path.join(currentDir, `${pageId}.png`))).toBe(true);
    }

    writeDumpDir(process.env.MAGI_DUMP_DIR, dumps);
  });
});

const liveWorkspace = process.env.MAGI_WORKSPACE_ROOT;
const liveDumpDir = process.env.MAGI_DUMP_DIR;

describe.skipIf(!liveWorkspace || !liveDumpDir)("live Magi compile dumps", () => {
  it("writes the shipped resolve/compile payload for every planned Magi page", () => {
    process.env.STORY_WORKSPACE_ROOT = liveWorkspace;
    delete process.env.STORY_WORKSPACE_DB_PATH;
    const dumps = dumpProjectPages("the-gift-of-the-magi");
    const ids = dumps.map((page) => page.pageId).sort();
    expect(ids).toEqual(
      expect.arrayContaining(["page-01-01", "page-01-02", "page-02-01", "page-03-01", "page-03-02", "page-05-01", "page-06-01"]),
    );
    expect(new Set(ids).size).toBe(ids.length);
    writeDumpDir(liveDumpDir, dumps);
    const confront = dumps.find((page) => page.pageId === "page-03-01")!;
    const gifts = dumps.find((page) => page.pageId === "page-03-02")!;
    expect(confront.dellaCondition).toMatch(/curl/i);
    expect(confront.prompt).not.toMatch(/knee-length brown hair/i);
    expect(gifts.prompt).toMatch(/sold (his |the )?watch/i);
  });
});

function seedMagiProject() {
  const project = createProject({ title: "Magi Chain" });
  const della = createEntity(project.id, { kind: "character", name: "Della" });
  const jim = createEntity(project.id, { kind: "character", name: "Jim" });
  updateEntity(project.id, della.id, {
    description: "A slender young woman. Her pride is knee-length brown hair.",
    visual: {
      base: "young American woman about twenty, slender, knee-length brown hair, 1900s tenement blouse",
      references: [],
      spatial: "",
    },
    states: { default: { outfit: "1900s blouse", condition: "knee-length brown hair, her greatest treasure" } },
    expectedUpdatedAt: della.updatedAt,
  });
  const chapter2 = createChapter(project.id, "volume-01", { title: "The curl" });
  const chapter3 = createChapter(project.id, "volume-01", { title: "The gifts" });
  const scene1 = readScene(project.id, "volume-01", "chapter-01", "scene-01");
  updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
    title: "Della counts her savings and reflects in the glass",
    script:
      "ONE dollar and eighty-seven cents. That was all. Della flopped on the shabby little couch and howled. She stood by the window. Rapidly she pulled down her hair and let it fall to its full length. Della’s hair was her treasure.",
    intent: "Della faces $1.87 and lets down her long hair.",
    characters: [della.id],
    expectedUpdatedAt: scene1.updatedAt,
  });
  replaceSceneShots(project.id, "volume-01", "chapter-01", "scene-01", [
    draftShot("scene-01", "shot-01", "Count the coins", "Della counts one dollar and eighty-seven cents."),
    draftShot("scene-01", "shot-02", "Poverty", "Della collapses on the shabby couch and weeps."),
    draftShot("scene-01", "shot-03", "Gray yard", "Della looks out at a gray cat on a gray fence."),
    draftShot("scene-01", "shot-04", "Pier glass", "Della whirls to the pier glass."),
    draftShot("scene-01", "shot-05", "Long hair as treasure", "Della lets her hair fall to its full length."),
  ]);

  const scene2 = createScene(project.id, "volume-01", chapter2.id, { title: "Della curls her hair and awaits Jim" });
  updateScene(project.id, "volume-01", chapter2.id, scene2.id, {
    script:
      "Within forty minutes her head was covered with tiny, close-lying curls. “If Jim doesn’t kill me,” she said to herself. She sat near the door. She whispered: “Please God, make him think I am still pretty.”",
    intent: "Della styles her freshly shorn hair and waits for Jim.",
    characters: [della.id],
    expectedUpdatedAt: scene2.updatedAt,
  });
  replaceSceneShots(project.id, "volume-01", chapter2.id, scene2.id, [
    draftShot(scene2.id, "shot-01", "Curl the cropped hair", "Della uses curling irons on her shorn hair."),
    draftShot(scene2.id, "shot-02", "Schoolboy curls", "Della studies her close-lying curls in the mirror."),
    draftShot(scene2.id, "shot-03", "Supper ready", "The frying-pan waits on the stove."),
    draftShot(scene2.id, "shot-04", "Wait and prayer", "Della sits at the table near the door and whispers a prayer to stay pretty."),
  ]);

  const scene3 = createScene(project.id, "volume-01", chapter3.id, { title: "Jim returns home and the gifts are revealed" });
  updateScene(project.id, "volume-01", chapter3.id, scene3.id, {
    script: [
      "The door opened and Jim stepped in and closed it.",
      "“Jim, darling,” she cried, “don’t look at me that way. I had my hair cut off and sold because I couldn’t have lived through Christmas without giving you a present.”",
      "“You’ve cut off your hair?” asked Jim.",
      "“Cut it off and sold it,” said Della. “Don’t you like me just as well, anyhow? I’m me without my hair, ain’t I?”",
      "“You say your hair is gone?” he said.",
      "“You needn’t look for it,” said Della. “It’s sold, I tell you—sold and gone, too. Shall I put the chops on, Jim?”",
      "“Don’t make any mistake, Dell,” he said, “about me. But if you’ll unwrap that package you may see why you had me going a while at first.”",
      "“My hair grows so fast, Jim!”",
      "And then Della leaped up and cried, “Oh, oh!”",
      "“Isn’t it a dandy, Jim? I hunted all over town to find it. Give me your watch.”",
      "“Dell,” said he, “let’s put our Christmas presents away and keep ’em a while. I sold the watch to get the money to buy your combs. And now suppose you put the chops on.”",
    ].join("\n"),
    intent: "Jim confronts Della's haircut; they exchange the combs and the fob chain; Jim sold the watch.",
    characters: [della.id, jim.id],
    expectedUpdatedAt: scene3.updatedAt,
  });
  replaceSceneShots(project.id, "volume-01", chapter3.id, scene3.id, [
    draftShot(scene3.id, "shot-01", "Jim's entrance and bewildered reaction to Della's short hair", "Jim steps inside the doorway and stares at Della."),
    draftShot(scene3.id, "shot-02", "Della pleads", "Della explains she sold her hair."),
    draftShot(scene3.id, "shot-03", "Reveal the combs", "Della unwraps the package of jeweled combs."),
    draftShot(scene3.id, "shot-04", "Della presenting her gift", "Della holds out the watch chain on her palm."),
    draftShot(scene3.id, "shot-05", "bittersweet resolution", "Jim sold his watch and smiles on the couch."),
  ]);

  writeContentState(project.id, "volume-01", chapter2.id, scene2.id, {
    patches: [
      {
        entityId: della.id,
        condition: "tiny, close-lying curls",
        supersedes: ["knee-length brown hair", "long hair"],
        truth: "canon",
      },
    ],
  });
  writeContentState(project.id, "volume-01", chapter3.id, scene3.id, {
    patches: [
      {
        entityId: della.id,
        condition: "tiny, close-lying curls",
        supersedes: ["knee-length brown hair", "long hair"],
        truth: "canon",
      },
    ],
  });

  return { projectId: project.id, dellaId: della.id, jimId: jim.id };
}

function dumpProjectPages(projectId: string) {
  const tree = readTree(projectId);
  const dumps: PageDump[] = [];
  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      for (const node of chapter.scenes) {
        const scene = readScene(projectId, volume.id, chapter.id, node.id);
        if (scene.shots.length === 0) {
          continue;
        }
        if (scene.dialogue.status !== "confirmed") {
          void confirmSceneDialogue(projectId, volume.id, chapter.id, scene.id);
        }
        const latest = readScene(projectId, volume.id, chapter.id, scene.id);
        const planned = planScenePages(latest.id, latest.shots, readStyle(projectId).layout);
        const pageIds = [...new Set(planned.map((item) => item.pageId))];
        for (const pageId of pageIds) {
          const members = planned
            .filter((item) => item.pageId === pageId)
            .slice()
            .sort((left, right) => left.panelIndex - right.panelIndex);
          const snapshots = members.map((item) =>
            resolveContext({
              projectId,
              volumeId: volume.id,
              chapterId: chapter.id,
              sceneId: latest.id,
              shotId: item.shotId,
            }),
          );
          const speech = confirmedSpeechByShot(latest);
          const compiled = compileComicsPagePrompt(snapshots, "", [], speech, readStyle(projectId).lettering, {
            layout: readStyle(projectId).layout,
            compose: readStyle(projectId).compose,
          });
          const della = snapshots[0]?.entities.find((entity) => entity.name === "Della");
          dumps.push({
            pageId,
            sceneId: latest.id,
            dellaIdentity: della?.visual.base ?? "",
            dellaCondition: della?.state.condition ?? "",
            actions: snapshots.map((snapshot) => snapshot.shot.action),
            shots: snapshots.map((snapshot) => ({
              id: snapshot.shot.id,
              purpose: snapshot.shot.purpose,
              action: snapshot.shot.action,
              lines: (speech[snapshot.shot.id] ?? []).map((line) => ({
                speaker: line.speaker,
                text: line.text,
              })),
            })),
            leftover: latest.dialogue.lines
              .filter((line) => line.shotId === null)
              .map((line) => ({ speaker: line.speaker, text: line.text })),
            prompt: compiled.prompt,
          });
        }
      }
    }
  }
  return dumps;
}

function writeDumpDir(dir: string | undefined, dumps: readonly PageDump[]) {
  if (!dir) {
    return;
  }
  mkdirSync(dir, { recursive: true });
  for (const page of dumps) {
    writeFileSync(path.join(dir, `${page.pageId}.json`), `${JSON.stringify(page, null, 2)}\n`, "utf8");
  }
}

function actionIndex(actions: readonly string[], pattern: RegExp): number {
  return actions.findIndex((action) => pattern.test(action));
}

function draftShot(sceneId: string, id: string, purpose: string, action: string) {
  return {
    id,
    scene_id: sceneId,
    purpose,
    action,
    camera: "medium",
    continuity_from: null,
    status: "pending" as const,
    selected_image: null,
    pageId: "",
    updatedAt: new Date().toISOString(),
  };
}

type PageDump = {
  pageId: string;
  sceneId: string;
  dellaIdentity: string;
  dellaCondition: string;
  actions: string[];
  shots: { id: string; purpose: string; action: string; lines: { speaker: string; text: string }[] }[];
  leftover: { speaker: string; text: string }[];
  prompt: string;
};
