import { describe, expect, it } from "vitest";

import { ensureStoryStructure } from "./story-structure";
import type { ProposedScene } from "./schemas";

function scene(title: string, chapterName = "", volumeName = ""): ProposedScene {
  return {
    key: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "scene",
    title,
    script: `${title} happens.`,
    intent: "",
    characterNames: [],
    locationName: null,
    propNames: [],
    costumeNames: [],
    volumeName,
    chapterName,
  };
}

describe("ensureStoryStructure", () => {
  it("keeps distinct chapter names from the model", () => {
    const scenes = ensureStoryStructure([
      scene("Open", "Night watch", "Harbor"),
      scene("Close", "Dawn", "Harbor"),
    ]);
    expect(scenes.map((item) => item.chapterName)).toEqual(["Night watch", "Dawn"]);
    expect(scenes.every((item) => item.volumeName === "Harbor")).toBe(true);
  });

  it("derives multiple chapters when the model omitted chapter names", () => {
    const scenes = ensureStoryStructure([
      scene("One"),
      scene("Two"),
      scene("Three"),
      scene("Four"),
    ]);
    const names = [...new Set(scenes.map((item) => item.chapterName))];
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(scenes[0]!.chapterName).toBe("One");
    expect(scenes[1]!.chapterName).toBe("One");
    expect(scenes[2]!.chapterName).toBe("Three");
    expect(scenes.every((item) => item.volumeName === "Volume 1")).toBe(true);
  });
});
