import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { GET as getStill } from "@/app/api/studio/projects/[projectId]/files/[...rel]/route";
import { POST as postGenerate } from "@/app/api/studio/projects/[projectId]/volumes/[volumeId]/chapters/[chapterId]/scenes/[sceneId]/shots/[shotId]/generate/route";
import { GET as getWorkflow } from "@/app/api/studio/projects/[projectId]/workflow/route";
import { directScene } from "../director";
import { StudioConflictError } from "../errors";
import { createEntity, createProject, getWorkspaceRoot, readScene, replaceSceneShots, updateScene, updateStyle } from "../fs";
import type { ImageAdapterInput } from "./adapter";
import { addEntityReferenceImage } from "./entity-references";
import { fakeImageAdapter, FAKE_PNG_BYTES, generateShot, listWorkflowNodes, lockShot, rerunUnlockedShot, STUB_PNG_BYTES } from "./index";
import { writeShotImageFile } from "./image-output";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;
const previousUserConfig = process.env.STORY_USER_CONFIG;
const previousImageApiKey = process.env.IMAGE_API_KEY;
const previousImageModel = process.env.IMAGE_MODEL;
const previousImageBaseUrl = process.env.IMAGE_BASE_URL;
const previousImageSize = process.env.IMAGE_SIZE;
const previousAiApiKey = process.env.AI_API_KEY;
const previousAiModel = process.env.AI_MODEL;
const WORKFLOW_LABELS = ["待跑", "成功", "失败", "锁定"] as const;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let workspaceRoot = "";
let userConfigDir = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-generate-"));
  userConfigDir = mkdtempSync(path.join(tmpdir(), "studio-generate-user-"));
  process.env.STORY_WORKSPACE_ROOT = workspaceRoot;
  process.env.STORY_USER_CONFIG = path.join(userConfigDir, "providers.json");
  delete process.env.STORY_WORKSPACE_DB_PATH;
  delete process.env.IMAGE_API_KEY;
  delete process.env.IMAGE_MODEL;
  delete process.env.IMAGE_BASE_URL;
  delete process.env.IMAGE_SIZE;
  delete process.env.AI_API_KEY;
  delete process.env.AI_MODEL;
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
  rmSync(userConfigDir, { recursive: true, force: true });

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

  restoreEnv("IMAGE_API_KEY", previousImageApiKey);
  restoreEnv("IMAGE_MODEL", previousImageModel);
  restoreEnv("IMAGE_BASE_URL", previousImageBaseUrl);
  restoreEnv("IMAGE_SIZE", previousImageSize);
  restoreEnv("AI_API_KEY", previousAiApiKey);
  restoreEnv("AI_MODEL", previousAiModel);
});

function restoreEnv(name: string, previous: string | undefined) {
  if (previous === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}

describe("generate, lock, and workflow", () => {
  it("writes a PNG file, sets shot.status to success, and stores a non-empty selected_image", async () => {
    expect(process.env.STORY_WORKSPACE_DB_PATH).toBeUndefined();
    const fixture = seedDirectedScene();

    const result = await generateShot(
      fixture.projectId,
      "volume-01",
      "chapter-01",
      "scene-01",
      "shot-01",
      { mode: "generate" },
      fakeImageAdapter,
    );

    expect(result.shot.status).toBe("success");
    expect(result.shot.selected_image).toBeTruthy();
    expect(result.shot.selected_image).toBe("outputs/comics/current/page-01-01.png");
    expect(result.compiled.prompt).toContain("ONE sequential comic PAGE as a single image");
    const pageShots = readScene(fixture.projectId, "volume-01", "chapter-01", "scene-01").shots;
    expect(pageShots[0]?.selected_image).toBe(result.shot.selected_image);
    expect(pageShots[1]?.selected_image).toBe(result.shot.selected_image);

    const absolute = path.join(getWorkspaceRoot(), fixture.projectId, ...result.shot.selected_image!.split("/"));
    expect(existsSync(absolute)).toBe(true);
    const bytes = readFileSync(absolute);
    expect(bytes.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(bytes.equals(FAKE_PNG_BYTES)).toBe(true);

    const diskShot = readScene(fixture.projectId, "volume-01", "chapter-01", "scene-01").shots.find(
      (shot) => shot.id === "shot-01",
    );
    expect(diskShot?.status).toBe("success");
    expect(diskShot?.selected_image).toBe(result.shot.selected_image);
    expect(result.node.statusLabel).toBe("成功");
  });

  it("rejects a 1x1 stub page as a failed generation", async () => {
    const fixture = seedDirectedScene();
    await expect(
      generateShot(
        fixture.projectId,
        "volume-01",
        "chapter-01",
        "scene-01",
        "shot-01",
        { mode: "generate" },
        (input) => writeShotImageFile(input, STUB_PNG_BYTES),
      ),
    ).rejects.toThrow(/unusable stub/i);
    const scene = readScene(fixture.projectId, "volume-01", "chapter-01", "scene-01");
    expect(scene.shots.every((shot) => shot.status === "failed")).toBe(true);
    expect(scene.shots[0]?.selected_image).toBeFalsy();
  });

  it("passes on-disk entity reference bytes into the image adapter", async () => {
    const project = createProject({ title: "Harbor Night" });
    const sue = createEntity(project.id, { kind: "character", name: "Sue" });
    addEntityReferenceImage(project.id, sue.id, FAKE_PNG_BYTES, "sue.png");
    const scene = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      characters: [sue.id],
      expectedUpdatedAt: scene.updatedAt,
    });
    replaceSceneShots(project.id, "volume-01", "chapter-01", "scene-01", [
      {
        id: "shot-01",
        scene_id: "scene-01",
        purpose: "Establish",
        action: "Sue waits at the desk.",
        camera: "medium",
        continuity_from: null,
        status: "pending",
        selected_image: null,
        pageId: "",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "shot-02",
        scene_id: "scene-01",
        purpose: "Turn",
        action: "Sue looks at the folder.",
        camera: "close-up",
        continuity_from: "shot-01",
        status: "pending",
        selected_image: null,
        pageId: "",
        updatedAt: new Date().toISOString(),
      },
    ]);

    const seen: ImageAdapterInput[] = [];
    const result = await generateShot(
      project.id,
      "volume-01",
      "chapter-01",
      "scene-01",
      "shot-01",
      { mode: "generate" },
      async (input) => {
        seen.push(input);
        return fakeImageAdapter(input);
      },
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]?.referenceImages?.length).toBe(1);
    expect(seen[0]?.referenceImages?.[0]?.bytes.equals(FAKE_PNG_BYTES)).toBe(true);
    expect(result.compiled.prompt).toContain("Attached image 1: character Sue");
    expect(result.compiled.prompt).toContain("Match identity from the attached reference images");
  });

  it("forwards an image provider override to the adapter", async () => {
    const fixture = seedDirectedScene();
    const seen: ImageAdapterInput[] = [];
    await generateShot(
      fixture.projectId,
      "volume-01",
      "chapter-01",
      "scene-01",
      "shot-01",
      { mode: "generate", image: { model: "gpt-image-2", size: "1024x1024", quality: "low" } },
      async (input) => {
        seen.push(input);
        return fakeImageAdapter(input);
      },
    );
    expect(seen[0]?.provider).toMatchObject({
      model: "gpt-image-2",
      size: "1024x1024",
      quality: "low",
    });
  });

  it("writes compose=page as one adapter call to current/", async () => {
    const fixture = seedDirectedScene();
    const seen: ImageAdapterInput[] = [];
    const result = await generateShot(
      fixture.projectId,
      "volume-01",
      "chapter-01",
      "scene-01",
      "shot-01",
      { mode: "generate" },
      async (input) => {
        seen.push(input);
        return fakeImageAdapter(input);
      },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]?.panelShotId).toBeUndefined();
    expect(result.shot.selected_image).toBe("outputs/comics/current/page-01-01.png");
    expect(
      existsSync(path.join(getWorkspaceRoot(), fixture.projectId, "outputs", "comics", "current", "page-01-01.png")),
    ).toBe(true);
  });

  it("writes compose=panels as one adapter per missing panel then a current composite", async () => {
    const fixture = seedDirectedScene();
    updateStyle(fixture.projectId, { compose: "panels", layout: "2" });
    const seen: ImageAdapterInput[] = [];
    const result = await generateShot(
      fixture.projectId,
      "volume-01",
      "chapter-01",
      "scene-01",
      "shot-01",
      { mode: "generate" },
      async (input) => {
        seen.push(input);
        return fakeImageAdapter(input);
      },
    );
    expect(seen).toHaveLength(2);
    expect(seen.map((item) => item.panelShotId)).toEqual(["shot-01", "shot-02"]);
    expect(result.shot.selected_image).toBe("outputs/comics/current/page-01-01.png");
    expect(
      existsSync(path.join(getWorkspaceRoot(), fixture.projectId, "outputs", "comics", "panels", "page-01-01", "shot-01.png")),
    ).toBe(true);
    expect(
      existsSync(path.join(getWorkspaceRoot(), fixture.projectId, "outputs", "comics", "panels", "page-01-01", "shot-02.png")),
    ).toBe(true);
    const current = path.join(getWorkspaceRoot(), fixture.projectId, "outputs", "comics", "current", "page-01-01.png");
    expect(existsSync(current)).toBe(true);
    expect(readFileSync(current).equals(FAKE_PNG_BYTES)).toBe(false);
  });

  it("archives the old current page on rerun and leaves only the new current file", async () => {
    const fixture = seedDirectedScene();
    const first = await generateShot(
      fixture.projectId,
      "volume-01",
      "chapter-01",
      "scene-01",
      "shot-01",
      { mode: "generate" },
      fakeImageAdapter,
    );
    const firstBytes = readFileSync(path.join(getWorkspaceRoot(), fixture.projectId, ...first.shot.selected_image!.split("/")));

    const second = await generateShot(
      fixture.projectId,
      "volume-01",
      "chapter-01",
      "scene-01",
      "shot-01",
      { mode: "regenerate" },
      fakeImageAdapter,
    );
    expect(second.shot.selected_image).toBe("outputs/comics/current/page-01-01.png");
    const currentDir = path.join(getWorkspaceRoot(), fixture.projectId, "outputs", "comics", "current");
    expect(readdirSync(currentDir)).toEqual(["page-01-01.png"]);
    const archiveRoot = path.join(getWorkspaceRoot(), fixture.projectId, "outputs", "archive");
    const batches = readdirSync(archiveRoot);
    expect(batches.length).toBe(1);
    const archived = path.join(archiveRoot, batches[0]!, "page-01-01.png");
    expect(existsSync(archived)).toBe(true);
    expect(readFileSync(archived).equals(firstBytes)).toBe(true);
  });

  it("keeps the current page when a rerun adapter fails", async () => {
    const fixture = seedDirectedScene();
    const first = await generateShot(
      fixture.projectId,
      "volume-01",
      "chapter-01",
      "scene-01",
      "shot-01",
      { mode: "generate" },
      fakeImageAdapter,
    );
    const selectedImage = first.shot.selected_image;
    const currentAbs = path.join(getWorkspaceRoot(), fixture.projectId, "outputs", "comics", "current", "page-01-01.png");
    const firstBytes = readFileSync(currentAbs);
    expect(existsSync(currentAbs)).toBe(true);

    await expect(
      generateShot(
        fixture.projectId,
        "volume-01",
        "chapter-01",
        "scene-01",
        "shot-01",
        { mode: "regenerate" },
        async () => {
          throw new Error("adapter boom");
        },
      ),
    ).rejects.toThrow(/adapter boom|GENERATION_FAILED|Image generation failed/);

    expect(existsSync(currentAbs)).toBe(true);
    expect(readFileSync(currentAbs).equals(firstBytes)).toBe(true);
    const after = readScene(fixture.projectId, "volume-01", "chapter-01", "scene-01").shots.find(
      (shot) => shot.id === "shot-01",
    );
    expect(after?.selected_image).toBe(selectedImage);
    const archiveRoot = path.join(getWorkspaceRoot(), fixture.projectId, "outputs", "archive");
    expect(existsSync(archiveRoot) ? readdirSync(archiveRoot) : []).toEqual([]);
    expect(
      existsSync(path.join(getWorkspaceRoot(), fixture.projectId, "outputs", "comics", "staging", "page-01-01.png")),
    ).toBe(false);
  });

  it("can compile a two-panel page when pageSize is 2", async () => {
    const fixture = seedDirectedScene();
    const seen: ImageAdapterInput[] = [];
    await generateShot(
      fixture.projectId,
      "volume-01",
      "chapter-01",
      "scene-01",
      "shot-01",
      { mode: "generate", pageSize: 2 },
      async (input) => {
        seen.push(input);
        return fakeImageAdapter(input);
      },
    );
    expect(seen[0]?.prompt).toContain("Panel 1");
    expect(seen[0]?.prompt).toContain("two stacked panels");
    expect(seen[0]?.prompt).not.toContain("Panel 3");
  });

  it("includes a non-empty continuityConstraints string on regenerate payload, node, and snapshot", async () => {
    const fixture = seedDirectedScene();

    const result = await generateShot(
      fixture.projectId,
      "volume-01",
      "chapter-01",
      "scene-01",
      "shot-02",
      { mode: "regenerate" },
      fakeImageAdapter,
    );

    expect(result.continuityConstraints.length).toBeGreaterThan(0);
    expect(result.node.continuityConstraints.length).toBeGreaterThan(0);
    expect(result.snapshot.continuityConstraints.length).toBeGreaterThan(0);
    expect(result.node.continuityConstraints).toBe(result.continuityConstraints);
    expect(result.snapshot.continuityConstraints).toBe(result.continuityConstraints);
    expect(result.continuityConstraints).toContain("shot-01");
    expect(result.continuityConstraints).toContain("shot-02");
    expect(result.compiled.prompt).toContain(result.continuityConstraints);

    const nodeFile = path.join(getWorkspaceRoot(), fixture.projectId, "workflow", "nodes", "shot-02.json");
    const stored = JSON.parse(readFileSync(nodeFile, "utf8")) as { continuityConstraints: string };
    expect(stored.continuityConstraints.length).toBeGreaterThan(0);
    expect(stored.continuityConstraints).toContain("shot-01");
  });

  it("rejects generate after lock and leaves selected_image unchanged", async () => {
    const fixture = seedDirectedScene();
    const generated = await generateShot(
      fixture.projectId,
      "volume-01",
      "chapter-01",
      "scene-01",
      "shot-01",
      { mode: "generate" },
      fakeImageAdapter,
    );
    const selectedImage = generated.shot.selected_image;
    expect(selectedImage).toBeTruthy();

    const locked = lockShot(fixture.projectId, "volume-01", "chapter-01", "scene-01", "shot-01");
    expect(locked.shot.status).toBe("locked");
    expect(locked.shot.selected_image).toBe(selectedImage);
    expect(locked.node.statusLabel).toBe("锁定");

    await expect(
      generateShot(
        fixture.projectId,
        "volume-01",
        "chapter-01",
        "scene-01",
        "shot-01",
        { mode: "generate" },
        fakeImageAdapter,
      ),
    ).rejects.toBeInstanceOf(StudioConflictError);

    await expect(rerunUnlockedShot(fixture.projectId, "shot-01", fakeImageAdapter)).rejects.toBeInstanceOf(
      StudioConflictError,
    );

    const after = readScene(fixture.projectId, "volume-01", "chapter-01", "scene-01").shots.find(
      (shot) => shot.id === "shot-01",
    );
    expect(after?.status).toBe("locked");
    expect(after?.selected_image).toBe(selectedImage);
  });

  it("exposes workflow statusLabel as 待跑/成功/失败/锁定 and accepts rerun of an unlocked shot", async () => {
    const fixture = seedDirectedScene();
    const pending = listWorkflowNodes(fixture.projectId);
    expect(pending.length).toBeGreaterThanOrEqual(2);
    for (const node of pending) {
      expect(WORKFLOW_LABELS).toContain(node.statusLabel);
    }
    expect(pending.map((node) => node.statusLabel)).toContain("待跑");

    const generated = await generateShot(
      fixture.projectId,
      "volume-01",
      "chapter-01",
      "scene-01",
      "shot-01",
      { mode: "generate" },
      fakeImageAdapter,
    );
    expect(generated.node.statusLabel).toBe("成功");

    const rerun = await rerunUnlockedShot(fixture.projectId, "shot-01", fakeImageAdapter);
    expect(rerun.shot.status).toBe("success");
    expect(rerun.node.statusLabel).toBe("成功");
    expect(rerun.shot.selected_image).toBeTruthy();
    expect(rerun.continuityConstraints.length).toBeGreaterThan(0);

    const nodes = listWorkflowNodes(fixture.projectId);
    for (const node of nodes) {
      expect(WORKFLOW_LABELS).toContain(node.statusLabel);
    }
    expect(nodes.find((node) => node.shotId === "shot-01")?.statusLabel).toBe("成功");
  });

  it("serves generate and workflow over HTTP without STORY_WORKSPACE_DB_PATH", async () => {
    expect(process.env.STORY_WORKSPACE_DB_PATH).toBeUndefined();
    const fixture = seedDirectedScene();

    const generated = await postGenerate(
      jsonRequest("http://localhost/api/studio/generate", "POST", { mode: "generate" }),
      shotParams(fixture.projectId, "shot-01"),
    );
    const generatedBody = await generated.json();
    expect(generated.status).toBe(200);
    expect(generatedBody.data.shot.status).toBe("success");
    expect(generatedBody.data.shot.selected_image).toBeTruthy();

    const workflow = await getWorkflow(
      new Request(`http://localhost/api/studio/projects/${fixture.projectId}/workflow`),
      { params: Promise.resolve({ projectId: fixture.projectId }) },
    );
    const workflowBody = await workflow.json();
    expect(workflow.status).toBe(200);
    expect(Array.isArray(workflowBody.data.nodes)).toBe(true);
    for (const node of workflowBody.data.nodes as Array<{ statusLabel: string }>) {
      expect(WORKFLOW_LABELS).toContain(node.statusLabel);
    }

    const relativePath = generatedBody.data.shot.selected_image as string;
    const still = await getStill(
      new Request(`http://localhost/api/studio/projects/${fixture.projectId}/files/${relativePath}`),
      {
        params: Promise.resolve({
          projectId: fixture.projectId,
          rel: relativePath.split("/"),
        }),
      },
    );
    expect(still.status).toBe(200);
    expect(still.headers.get("content-type")).toBe("image/png");
    const stillBytes = Buffer.from(await still.arrayBuffer());
    expect(stillBytes.subarray(0, 8)).toEqual(PNG_SIGNATURE);

    const traversal = await getStill(
      new Request(`http://localhost/api/studio/projects/${fixture.projectId}/files/../secret.png`),
      {
        params: Promise.resolve({
          projectId: fixture.projectId,
          rel: ["..", "secret.png"],
        }),
      },
    );
    expect(traversal.status).toBe(400);
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

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function shotParams(projectId: string, shotId: string) {
  return {
    params: Promise.resolve({
      projectId,
      volumeId: "volume-01",
      chapterId: "chapter-01",
      sceneId: "scene-01",
      shotId,
    }),
  };
}
