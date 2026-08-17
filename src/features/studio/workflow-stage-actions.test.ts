import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { POST as postDirector } from "@/app/api/studio/projects/[projectId]/volumes/[volumeId]/chapters/[chapterId]/scenes/[sceneId]/director/route";
import { GET as getScene, PATCH as patchScene } from "@/app/api/studio/projects/[projectId]/volumes/[volumeId]/chapters/[chapterId]/scenes/[sceneId]/route";
import { POST as postGenerate } from "@/app/api/studio/projects/[projectId]/volumes/[volumeId]/chapters/[chapterId]/scenes/[sceneId]/shots/[shotId]/generate/route";
import { GET as getTree } from "@/app/api/studio/projects/[projectId]/tree/route";
import { POST as postProjectDialogue } from "@/app/api/studio/projects/[projectId]/dialogue/confirm/route";
import { GET as getWorkflow } from "@/app/api/studio/projects/[projectId]/workflow/route";
import { GET as getParse, POST as postParse } from "@/app/api/studio/projects/[projectId]/parse/route";
import { POST as postParseConfirm } from "@/app/api/studio/projects/[projectId]/parse/[runId]/confirm/route";
import { createProject, readScene, updateScene } from "@/studio/fs";
import { writeParseRun } from "@/studio/parse/runs";
import {
  confirmStudioParseRun,
  confirmStudioProjectDialogue,
  directStudioScene,
  generateStudioShot,
  getStudioScene,
  getStudioTree,
  getStudioWorkflow,
  listScenePaths,
  listStudioParseRuns,
} from "./api";

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
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-workflow-actions-"));
  userConfigDir = mkdtempSync(path.join(tmpdir(), "studio-workflow-actions-user-"));
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

function restoreEnv(name: string, previous: string | undefined) {
  if (previous === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}

describe("Workflow stage primary actions", () => {
  it("wires import, storyboard, dialogue, and comics clicks to the shipped studio HTTP", () => {
    const source = readFileSync(path.join(__dirname, "WorkflowPanel.tsx"), "utf8");
    expect(source).toContain('data-workflow-action="import"');
    expect(source).toContain('data-workflow-action="storyboard"');
    expect(source).toContain('data-workflow-action="dialogue"');
    expect(source).toContain('data-workflow-action="comics"');
    expect(source).toContain("parseStudioText");
    expect(source).toContain("confirmStudioParseRun");
    expect(source).toContain("listStudioParseRuns");
    expect(source).toContain("directStudioScene");
    expect(source).toContain("confirmStudioProjectDialogue");
    expect(source).toContain("generateStudioShot");
  });

  it("runs the official chain through the same client helpers Workflow clicks use", async () => {
    const project = createProject({ title: "Workflow Harbor" });
    const scene = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      script: 'Sue: "The last leaf is still there."\nJohnsy: "I thought it would fall."',
      expectedUpdatedAt: scene.updatedAt,
    });

    const before = await getStudioWorkflow(project.id);
    expect(stage(before.pipeline, "storyboard").status).toBe("pending");
    expect(stage(before.pipeline, "dialogue").status).toBe("pending");
    expect(stage(before.pipeline, "comics").status).toBe("pending");

    const tree = await getStudioTree(project.id);
    const pathIds = listScenePaths(tree)[0]!;
    const loaded = await getStudioScene(project.id, pathIds);
    expect(loaded.script).toContain("The last leaf");

    await directStudioScene(project.id, pathIds);
    const boarded = await getStudioWorkflow(project.id);
    expect(stage(boarded.pipeline, "storyboard").status).toBe("success");
    expect(stage(boarded.pipeline, "dialogue").status).toBe("pending");

    await confirmStudioProjectDialogue(project.id);
    const confirmed = await getStudioWorkflow(project.id);
    expect(stage(confirmed.pipeline, "dialogue").status).toBe("success");

    const directed = await getStudioScene(project.id, pathIds);
    const firstShot = directed.shots[0];
    expect(firstShot).toBeDefined();
    const generated = await generateStudioShot(project.id, pathIds, firstShot!.id);
    expect(generated.shot.selected_image).toBeTruthy();

    const finished = await getStudioWorkflow(project.id);
    expect(stage(finished.pipeline, "comics").status).toBe("success");
  });

  it("confirms import through the parse HTTP Workflow uses, not a second importer", async () => {
    const project = createProject({ title: "Import Harbor" });
    const now = new Date().toISOString();
    writeParseRun(project.id, {
      id: "parse-01",
      status: "pending",
      sourceText: "Sue waits at the window.\n\nSue: \"The leaf is still there.\"",
      proposedScenes: [
        {
          key: "scene-window",
          title: "Window watch",
          script: "Sue waits at the window.\n\nSue: \"The leaf is still there.\"",
          intent: "Sue watches the ivy.",
          characterNames: ["Sue"],
          locationName: "Studio",
          propNames: [],
          costumeNames: [],
          volumeName: "Volume 1",
          chapterName: "Chapter 1",
        },
      ],
      proposedEntities: [
        { key: "ent-sue", kind: "character", name: "Sue", description: "A young artist." },
        { key: "ent-studio", kind: "location", name: "Studio", description: "A rented room." },
      ],
      createdAt: now,
      updatedAt: now,
    });

    const listed = await listStudioParseRuns(project.id);
    expect(listed.some((item) => item.id === "parse-01" && item.status === "pending")).toBe(true);

    const before = await getStudioWorkflow(project.id);
    expect(stage(before.pipeline, "import").status).toBe("pending");

    await confirmStudioParseRun(project.id, "parse-01");
    const imported = await getStudioWorkflow(project.id);
    expect(stage(imported.pipeline, "import").status).toBe("success");
  });
});

function stage(
  pipeline: { stages: { id: string; status: string }[] },
  id: string,
) {
  const found = pipeline.stages.find((item) => item.id === id);
  if (!found) {
    throw new Error(`missing stage ${id}`);
  }
  return found;
}

async function dispatchStudioFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = toRequest(input, init);
  const url = new URL(request.url);
  const pathname = url.pathname;

  const generate = pathname.match(
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

  const director = pathname.match(
    /^\/api\/studio\/projects\/([^/]+)\/volumes\/([^/]+)\/chapters\/([^/]+)\/scenes\/([^/]+)\/director$/,
  );
  if (director && request.method === "POST") {
    return postDirector(request, {
      params: Promise.resolve({
        projectId: director[1]!,
        volumeId: director[2]!,
        chapterId: director[3]!,
        sceneId: director[4]!,
      }),
    });
  }

  const scene = pathname.match(
    /^\/api\/studio\/projects\/([^/]+)\/volumes\/([^/]+)\/chapters\/([^/]+)\/scenes\/([^/]+)$/,
  );
  if (scene && request.method === "GET") {
    return getScene(request, {
      params: Promise.resolve({
        projectId: scene[1]!,
        volumeId: scene[2]!,
        chapterId: scene[3]!,
        sceneId: scene[4]!,
      }),
    });
  }
  if (scene && request.method === "PATCH") {
    return patchScene(request, {
      params: Promise.resolve({
        projectId: scene[1]!,
        volumeId: scene[2]!,
        chapterId: scene[3]!,
        sceneId: scene[4]!,
      }),
    });
  }

  const parseConfirm = pathname.match(/^\/api\/studio\/projects\/([^/]+)\/parse\/([^/]+)\/confirm$/);
  if (parseConfirm && request.method === "POST") {
    return postParseConfirm(request, {
      params: Promise.resolve({ projectId: parseConfirm[1]!, runId: parseConfirm[2]! }),
    });
  }

  const parse = pathname.match(/^\/api\/studio\/projects\/([^/]+)\/parse$/);
  if (parse && request.method === "GET") {
    return getParse(request, { params: Promise.resolve({ projectId: parse[1]! }) });
  }
  if (parse && request.method === "POST") {
    return postParse(request, { params: Promise.resolve({ projectId: parse[1]! }) });
  }

  const dialogue = pathname.match(/^\/api\/studio\/projects\/([^/]+)\/dialogue\/confirm$/);
  if (dialogue && request.method === "POST") {
    return postProjectDialogue(request, { params: Promise.resolve({ projectId: dialogue[1]! }) });
  }

  const tree = pathname.match(/^\/api\/studio\/projects\/([^/]+)\/tree$/);
  if (tree && request.method === "GET") {
    return getTree(request, { params: Promise.resolve({ projectId: tree[1]! }) });
  }

  const workflow = pathname.match(/^\/api\/studio\/projects\/([^/]+)\/workflow$/);
  if (workflow && request.method === "GET") {
    return getWorkflow(request, { params: Promise.resolve({ projectId: workflow[1]! }) });
  }

  throw new Error(`Unhandled studio fetch in test: ${request.method} ${pathname}`);
}

function toRequest(input: RequestInfo | URL, init?: RequestInit): Request {
  if (input instanceof Request) {
    return input;
  }
  const href = typeof input === "string" ? input : input.toString();
  return new Request(href.startsWith("http") ? href : `http://localhost${href}`, init);
}
