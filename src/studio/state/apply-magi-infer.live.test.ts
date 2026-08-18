import { describe, expect, it } from "vitest";
import { reassignSceneDialogue } from "../dialogue";
import { readContentState, readScene } from "../fs";
import { writeInferredSceneStates } from "./infer-scene-state";

describe.skipIf(process.env.SOAK_MAGI !== "1")("apply infer to magi project", () => {
  it("writes haircut state from scripts", () => {
    process.env.STORY_WORKSPACE_ROOT = "/home/ubuntu/MyCode/StoryWorkspace/.data/projects";
    delete process.env.STORY_WORKSPACE_DB_PATH;
    const written = writeInferredSceneStates("the-gift-of-the-magi");
    expect(written.some((item) => item.sceneId === "scene-02")).toBe(true);
    expect(written.some((item) => item.sceneId === "scene-03")).toBe(true);
    expect(written.some((item) => item.sceneId === "scene-05")).toBe(false);
    expect(readContentState("the-gift-of-the-magi", "volume-01", "chapter-01", "scene-01")?.patches ?? []).toEqual([]);
    const stored = readContentState("the-gift-of-the-magi", "volume-01", "chapter-02", "scene-02");
    expect(stored?.patches[0]?.entityId).toBe("character-01");
    expect(stored?.patches[0]?.condition).toMatch(/curl/i);
    const later = readContentState("the-gift-of-the-magi", "volume-01", "chapter-03", "scene-03");
    expect(later?.patches.some((patch) => /curl/i.test(patch.condition ?? "") && patch.entityId === "character-01")).toBe(
      true,
    );
    expect(later?.patches.some((patch) => patch.entityId === "character-02")).toBe(false);
    expect(
      readContentState("the-gift-of-the-magi", "volume-01", "chapter-02", "scene-02")?.patches.some(
        (patch) => patch.entityId === "character-02",
      ),
    ).toBe(false);
    expect(
      readContentState("the-gift-of-the-magi", "volume-01", "chapter-03", "scene-07")?.patches.some(
        (patch) => patch.entityId === "character-02",
      ),
    ).toBe(false);
    expect(readContentState("the-gift-of-the-magi", "volume-01", "chapter-05", "scene-05")?.patches ?? []).toEqual([]);
    const chain = readContentState("the-gift-of-the-magi", "volume-01", "chapter-05", "scene-06");
    expect(chain?.patches).toEqual([
      expect.objectContaining({ entityId: "character-01", condition: expect.stringMatching(/hair|cut|curl|shorn/i) }),
    ]);

    const shop = reassignSceneDialogue("the-gift-of-the-magi", "volume-01", "chapter-05", "scene-05");
    const buyHair = shop.dialogue.lines.find((line) => /will you buy my hair/i.test(line.text));
    expect(buyHair?.shotId).toBe("shot-02");
    expect(readScene("the-gift-of-the-magi", "volume-01", "chapter-05", "scene-05").dialogue.lines.find((line) =>
      /will you buy my hair/i.test(line.text),
    )?.shotId).toBe("shot-02");
  });
});
