import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";

import { resolveContext } from "../context";
import { compileImagePrompt } from "./compile-prompt";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;
const workspaceRoot = path.resolve(process.cwd(), ".data/projects");
const scenePath = path.join(
  workspaceRoot,
  "the-last-leaf",
  "content",
  "volumes",
  "volume-01",
  "chapters",
  "chapter-01",
  "scenes",
  "scene-06.json",
);

describe.skipIf(!existsSync(scenePath))("real Last Leaf scene-06 compile cast lock", () => {
  beforeEach(() => {
    process.env.STORY_WORKSPACE_ROOT = workspaceRoot;
    delete process.env.STORY_WORKSPACE_DB_PATH;
  });

  afterEach(() => {
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

  it("locks Sue and Johnsy on shot-17 and shot-18, and does not identity-lock Behrman on shot-23", () => {
    expect(existsSync(scenePath), `missing directed scene at ${scenePath}`).toBe(true);

    const prompt17 = compileShot("shot-17");
    const prompt18 = compileShot("shot-18");
    const prompt23 = compileShot("shot-23");

    console.log("SHOT-17 PROMPT\n" + prompt17);
    console.log("SHOT-18 PROMPT\n" + prompt18);
    console.log("SHOT-23 PROMPT\n" + prompt23);

    for (const prompt of [prompt17, prompt18]) {
      expect(prompt).toContain("identity lock Sue:");
      expect(prompt).toContain("identity lock Johnsy:");
      expect(prompt).toContain("Action:");
      expect(prompt).not.toContain("identity lock Behrman");
      expect(prompt).not.toMatch(/character Behrman/);
      expect(prompt).not.toContain("identity lock Doctor");
      expect(prompt).not.toMatch(/character Doctor/);
    }

    expect(prompt17).toContain("Johnsy continues watching the leaf");
    expect(prompt18).toContain("Sue hugs Johnsy");
    expect(prompt17).not.toBe(prompt18);

    expect(prompt23).toContain("painted leaf remains on the wall");
    expect(prompt23).not.toContain("identity lock Behrman");
    expect(prompt23).not.toMatch(/character Behrman/);
  });
});

function compileShot(shotId: string) {
  const snapshot = resolveContext({
    projectId: "the-last-leaf",
    volumeId: "volume-01",
    chapterId: "chapter-01",
    sceneId: "scene-06",
    shotId,
  });
  return compileImagePrompt(snapshot).prompt;
}
