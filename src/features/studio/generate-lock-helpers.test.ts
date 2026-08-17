import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { POST as postGenerate } from "@/app/api/studio/projects/[projectId]/volumes/[volumeId]/chapters/[chapterId]/scenes/[sceneId]/shots/[shotId]/generate/route";
import { POST as postLock } from "@/app/api/studio/projects/[projectId]/volumes/[volumeId]/chapters/[chapterId]/scenes/[sceneId]/shots/[shotId]/lock/route";
import { GET as getWorkflow } from "@/app/api/studio/projects/[projectId]/workflow/route";
import { directScene } from "@/studio/director";
import { createProject, getWorkspaceRoot, readScene, updateScene } from "@/studio/fs";
import { generateStudioShot, getStudioWorkflow, lockStudioShot } from "./api";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;
const previousUserConfig = process.env.STORY_USER_CONFIG;
const previousImageApiKey = process.env.IMAGE_API_KEY;
const previousImageModel = process.env.IMAGE_MODEL;
const previousImageBaseUrl = process.env.IMAGE_BASE_URL;
const previousImageSize = process.env.IMAGE_SIZE;
const originalFetch = globalThis.fetch;

let workspaceRoot = "";
let userConfigDir = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-frontend-generate-"));
  userConfigDir = mkdtempSync(path.join(tmpdir(), "studio-frontend-generate-user-"));
  process.env.STORY_WORKSPACE_ROOT = workspaceRoot;
  process.env.STORY_USER_CONFIG = path.join(userConfigDir, "providers.json");
  delete process.env.STORY_WORKSPACE_DB_PATH;
  delete process.env.IMAGE_API_KEY;
  delete process.env.IMAGE_MODEL;
  delete process.env.IMAGE_BASE_URL;
  delete process.env.IMAGE_SIZE;
  globalThis.fetch = dispatchStudioFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(workspaceRoot, { recursive: true, force: true });
  rmSync(userConfigDir, { recursive: true, force: true });
  restoreEnv("STORY_WORKSPACE_ROOT", previousWorkspaceRoot);
  restoreEnv("STORY_WORKSPACE_DB_PATH", previousDbPath);
  restoreEnv("STORY_USER_CONFIG", previousUserConfig);
  restoreEnv("IMAGE_API_KEY", previousImageApiKey);
  restoreEnv("IMAGE_MODEL", previousImageModel);
  restoreEnv("IMAGE_BASE_URL", previousImageBaseUrl);
  restoreEnv("IMAGE_SIZE", previousImageSize);
});

describe("generateStudioShot and lockStudioShot against real HTTP routes", () => {
  it("generates a page image then locks the matching workflow node", async () => {
    const fixture = seedDirectedScene();
    const pathIds = {
      volumeId: "volume-01",
      chapterId: "chapter-01",
      sceneId: "scene-01",
    };

    const generated = await generateStudioShot(fixture.projectId, pathIds, "shot-01");
    expect(generated.shot.selected_image).toBeTruthy();
    expect(generated.shot.selected_image?.length).toBeGreaterThan(0);
    expect(generated.shot.status).toBe("success");

    const absolute = path.join(
      getWorkspaceRoot(),
      fixture.projectId,
      ...generated.shot.selected_image!.split("/"),
    );
    expect(existsSync(absolute)).toBe(true);

    const locked = await lockStudioShot(fixture.projectId, pathIds, "shot-01", true);
    expect(locked.shot.status).toBe("locked");
    expect(locked.node.locked).toBe(true);
    expect(locked.node.status).toBe("locked");

    const { nodes } = await getStudioWorkflow(fixture.projectId);
    const node = nodes.find((item) => item.shotId === "shot-01");
    expect(node?.locked).toBe(true);
    expect(node?.status).toBe("locked");
    expect(node?.statusLabel).toBe("锁定");
  });
});

function seedDirectedScene() {
  const project = createProject({ title: "Harbor Night" });
  const scene = readScene(project.id, "volume-01", "chapter-01", "scene-01");
  updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
    script: "Jill waits under a lantern.\n\nShe looks toward the water.",
    intent: "Establish Jill waiting for a signal.",
    expectedUpdatedAt: scene.updatedAt,
  });
  const directed = directScene(project.id, "volume-01", "chapter-01", "scene-01");
  expect(directed.shots.length).toBeGreaterThanOrEqual(2);
  return { projectId: project.id, scene: directed };
}

function restoreEnv(name: string, previous: string | undefined) {
  if (previous === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}

async function dispatchStudioFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = toRequest(input, init);
  const url = new URL(request.url);
  const generate = url.pathname.match(
    /^\/api\/studio\/projects\/([^/]+)\/volumes\/([^/]+)\/chapters\/([^/]+)\/scenes\/([^/]+)\/shots\/([^/]+)\/generate$/,
  );
  if (generate && request.method === "POST") {
    return postGenerate(request, {
      params: Promise.resolve({
        projectId: generate[1]!,
        volumeId: generate[2]!,
        chapterId: generate[3]!,
        sceneId: generate[4]!,
        shotId: generate[5]!,
      }),
    });
  }

  const lock = url.pathname.match(
    /^\/api\/studio\/projects\/([^/]+)\/volumes\/([^/]+)\/chapters\/([^/]+)\/scenes\/([^/]+)\/shots\/([^/]+)\/lock$/,
  );
  if (lock && request.method === "POST") {
    return postLock(request, {
      params: Promise.resolve({
        projectId: lock[1]!,
        volumeId: lock[2]!,
        chapterId: lock[3]!,
        sceneId: lock[4]!,
        shotId: lock[5]!,
      }),
    });
  }

  const workflow = url.pathname.match(/^\/api\/studio\/projects\/([^/]+)\/workflow$/);
  if (workflow && request.method === "GET") {
    return getWorkflow(request, { params: Promise.resolve({ projectId: workflow[1]! }) });
  }

  throw new Error(`Unhandled studio fetch in test: ${request.method} ${url.pathname}`);
}

function toRequest(input: RequestInfo | URL, init?: RequestInit): Request {
  if (input instanceof Request) {
    return input;
  }
  const href = typeof input === "string" ? input : input.toString();
  return new Request(href.startsWith("http") ? href : `http://localhost${href}`, init);
}
