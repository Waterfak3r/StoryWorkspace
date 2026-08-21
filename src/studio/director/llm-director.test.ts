import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveContext, storyPositionEventsForScene } from "../context";
import { createProject, createScene, readScene, updateScene } from "../fs";
import { writeProviderSettings } from "../settings";
import { ARTISTIC_CAMERAS, defaultDirector, directSceneAsync } from "./direct-scene";
import { formatPriorStoryEvents, llmDirector } from "./llm-director";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;
const previousUserConfig = process.env.STORY_USER_CONFIG;
const previousAiApiKey = process.env.AI_API_KEY;
const previousAiModel = process.env.AI_MODEL;
const previousAiBaseUrl = process.env.AI_BASE_URL;
const originalFetch = globalThis.fetch;

let workspaceRoot = "";
let userConfigDir = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-llm-director-"));
  userConfigDir = mkdtempSync(path.join(tmpdir(), "studio-llm-director-user-"));
  process.env.STORY_WORKSPACE_ROOT = workspaceRoot;
  process.env.STORY_USER_CONFIG = path.join(userConfigDir, "providers.json");
  delete process.env.STORY_WORKSPACE_DB_PATH;
  delete process.env.AI_API_KEY;
  delete process.env.AI_MODEL;
  delete process.env.AI_BASE_URL;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(workspaceRoot, { recursive: true, force: true });
  rmSync(userConfigDir, { recursive: true, force: true });
  restoreEnv("STORY_WORKSPACE_ROOT", previousWorkspaceRoot);
  restoreEnv("STORY_WORKSPACE_DB_PATH", previousDbPath);
  restoreEnv("STORY_USER_CONFIG", previousUserConfig);
  restoreEnv("AI_API_KEY", previousAiApiKey);
  restoreEnv("AI_MODEL", previousAiModel);
  restoreEnv("AI_BASE_URL", previousAiBaseUrl);
});

describe("llm director storyPosition.events evidence", () => {
  it("sends the same prior-event titles and summaries that storyPosition.events lists", async () => {
    const fixture = seedTwoSceneProject();
    configureTextProvider();
    const expected = storyPositionEventsForScene(
      fixture.projectId,
      fixture.volumeId,
      fixture.chapterId,
      fixture.laterSceneId,
    );
    expect(expected.length).toBeGreaterThan(0);

    const captured = captureDirectorCompletions();
    const directed = await directSceneAsync(
      fixture.projectId,
      fixture.volumeId,
      fixture.chapterId,
      fixture.laterSceneId,
    );

    expect(directed.shots.length).toBeGreaterThanOrEqual(2);
    expect(captured.userPrompts).toHaveLength(1);
    const prompt = captured.userPrompts[0]!;
    expect(prompt).toContain("Prior story:");
    for (const event of expected) {
      expect(prompt).toContain(event.title);
      if (event.summary.trim()) {
        expect(prompt).toContain(event.summary);
      }
    }
    expect(prompt).toContain(formatPriorStoryEvents(expected));

    const snapshot = resolveContext({
      projectId: fixture.projectId,
      volumeId: fixture.volumeId,
      chapterId: fixture.chapterId,
      sceneId: fixture.laterSceneId,
      shotId: directed.shots[0]!.id,
    });
    expect(snapshot.storyPosition.events).toEqual(expected);
  });

  it("keeps the first scene recap empty and does not invent later titles", async () => {
    const fixture = seedTwoSceneProject();
    configureTextProvider();
    const expected = storyPositionEventsForScene(
      fixture.projectId,
      fixture.volumeId,
      fixture.chapterId,
      fixture.firstSceneId,
    );
    expect(expected).toEqual([]);

    const captured = captureDirectorCompletions();
    await directSceneAsync(fixture.projectId, fixture.volumeId, fixture.chapterId, fixture.firstSceneId);

    expect(captured.userPrompts).toHaveLength(1);
    const prompt = captured.userPrompts[0]!;
    expect(prompt).toContain("Prior story:");
    expect(prompt).toContain(formatPriorStoryEvents([]));
    expect(prompt).not.toContain(fixture.laterTitle);
    expect(prompt).not.toContain(fixture.laterSummary);
  });

  it("uses the non-LLM fallback when no text Provider is configured", async () => {
    const fixture = seedTwoSceneProject();
    const captured = captureDirectorCompletions();
    const scene = readScene(fixture.projectId, fixture.volumeId, fixture.chapterId, fixture.laterSceneId);
    const directed = await directSceneAsync(
      fixture.projectId,
      fixture.volumeId,
      fixture.chapterId,
      fixture.laterSceneId,
    );
    const fallback = defaultDirector(scene);

    expect(captured.userPrompts).toEqual([]);
    expect(captured.fetchMock).not.toHaveBeenCalled();
    expect(directed.shots.map((shot) => ({ purpose: shot.purpose, action: shot.action, camera: shot.camera }))).toEqual(
      fallback.map((shot) => ({ purpose: shot.purpose, action: shot.action, camera: shot.camera })),
    );
    expect(ARTISTIC_CAMERAS).toContain(directed.shots[0]!.camera);
    expect(directed.shots.some((shot) => shot.action.includes(fixture.firstTitle))).toBe(false);
    expect(directed.shots.some((shot) => shot.action.includes(fixture.firstSummary))).toBe(false);
  });

  it("does not invent prior-plot facts when storyPosition.events is empty", async () => {
    configureTextProvider();
    const scene = readScene(createProject({ title: "Empty Recap" }).id, "volume-01", "chapter-01", "scene-01");
    const captured = captureDirectorCompletions();
    await llmDirector(scene, { storyPosition: { events: [] } });
    expect(captured.userPrompts).toHaveLength(1);
    expect(captured.userPrompts[0]).toContain("Prior story:");
    expect(captured.userPrompts[0]).toContain("- none");
    expect(captured.userPrompts[0]).not.toMatch(/Prior story:\n- (?!none).+/);
  });
});

function seedTwoSceneProject() {
  const project = createProject({ title: "Watch Recap" });
  const first = readScene(project.id, "volume-01", "chapter-01", "scene-01");
  const firstTitle = "Harbor watch";
  const firstSummary = "A lookout waits for a signal on the quay.";
  updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
    title: firstTitle,
    script: "The lookout waits under a lantern.",
    intent: firstSummary,
    expectedUpdatedAt: first.updatedAt,
  });
  const laterTitle = "After the storm";
  const laterSummary = "The wait has a cost on the flooded dock.";
  const later = createScene(project.id, "volume-01", "chapter-01", { title: laterTitle });
  updateScene(project.id, "volume-01", "chapter-01", later.id, {
    script: "The lookout stands on the flooded dock.",
    intent: laterSummary,
    expectedUpdatedAt: later.updatedAt,
  });
  return {
    projectId: project.id,
    volumeId: "volume-01",
    chapterId: "chapter-01",
    firstSceneId: first.id,
    laterSceneId: later.id,
    firstTitle,
    firstSummary,
    laterTitle,
    laterSummary,
  };
}

function configureTextProvider() {
  writeProviderSettings({
    text: {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test-director",
      model: "gpt-4o",
      protocol: "chat",
    },
    image: {
      baseUrl: "",
      apiKey: "",
      model: "",
      size: "",
      quality: "",
    },
  });
}

function captureDirectorCompletions() {
  const userPrompts: string[] = [];
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ role?: string; content?: unknown }>;
    };
    const user = body.messages?.find((message) => message.role === "user")?.content;
    if (typeof user === "string") {
      userPrompts.push(user);
    }
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  shots: [
                    {
                      purpose: "Establish the beat",
                      action: "Open from the supplied evidence only.",
                      camera: "wide establishing shot, slow push-in",
                    },
                    {
                      purpose: "Close the beat",
                      action: "Hold the consequence of the supplied evidence.",
                      camera: "close-up, hold on the face",
                    },
                  ],
                }),
              },
            },
          ],
        }),
    };
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, userPrompts };
}

function restoreEnv(name: string, previous: string | undefined) {
  if (previous === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}
