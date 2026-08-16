import { mkdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { assembleStoryOutline } from "../outline";
import { ingestFixtureStory } from "./fixture-stories";

describe("seed launch workspace", () => {
  it.skipIf(!process.env.STORY_LAUNCH_WORKSPACE)("writes a confirmed Last Leaf project when STORY_LAUNCH_WORKSPACE is set", async () => {
    const root = process.env.STORY_LAUNCH_WORKSPACE;
    if (!root) {
      expect(true).toBe(true);
      return;
    }

    mkdirSync(root, { recursive: true });
    process.env.STORY_WORKSPACE_ROOT = root;
    delete process.env.STORY_WORKSPACE_DB_PATH;

    const { project, confirmed } = await ingestFixtureStory("The Last Leaf", "last-leaf");
    const outline = assembleStoryOutline(project.id);
    expect(confirmed.scenes.length).toBeGreaterThan(0);
    expect(outline.volumes[0]?.chapters[0]?.scenes.some((scene) => scene.title.length > 0)).toBe(true);
  });
});
