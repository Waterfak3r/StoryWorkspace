import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { GET as getWorkspace } from "@/app/api/studio/workspace/route";
import { POST as postProject } from "@/app/api/studio/projects/route";
import { GET as getProject } from "@/app/api/studio/projects/[projectId]/route";
import { GET as getTree } from "@/app/api/studio/projects/[projectId]/tree/route";
import { POST as postVolume } from "@/app/api/studio/projects/[projectId]/volumes/route";
import { DELETE as deleteVolume } from "@/app/api/studio/projects/[projectId]/volumes/[volumeId]/route";
import { POST as postChapter } from "@/app/api/studio/projects/[projectId]/volumes/[volumeId]/chapters/route";
import { DELETE as deleteChapter } from "@/app/api/studio/projects/[projectId]/volumes/[volumeId]/chapters/[chapterId]/route";
import { POST as postScene } from "@/app/api/studio/projects/[projectId]/volumes/[volumeId]/chapters/[chapterId]/scenes/route";
import {
  DELETE as deleteScene,
  GET as getScene,
  PATCH as patchScene,
} from "@/app/api/studio/projects/[projectId]/volumes/[volumeId]/chapters/[chapterId]/scenes/[sceneId]/route";
import {
  GET as getEntities,
  POST as postEntity,
} from "@/app/api/studio/projects/[projectId]/entities/route";
import { GET as getEntity } from "@/app/api/studio/projects/[projectId]/entities/[entityId]/route";
import { POST as postDirector } from "@/app/api/studio/projects/[projectId]/volumes/[volumeId]/chapters/[chapterId]/scenes/[sceneId]/director/route";
import { GET as getShots } from "@/app/api/studio/projects/[projectId]/volumes/[volumeId]/chapters/[chapterId]/scenes/[sceneId]/shots/route";
import { PATCH as patchShot } from "@/app/api/studio/projects/[projectId]/volumes/[volumeId]/chapters/[chapterId]/scenes/[sceneId]/shots/[shotId]/route";
import { GET as getContext } from "@/app/api/studio/projects/[projectId]/volumes/[volumeId]/chapters/[chapterId]/scenes/[sceneId]/context/route";
import { getWorkspaceRoot } from "@/studio/fs";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;

let workspaceRoot = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-http-"));
  process.env.STORY_WORKSPACE_ROOT = workspaceRoot;
  delete process.env.STORY_WORKSPACE_DB_PATH;
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
});

describe("studio HTTP routes", () => {
  it("POSTs a project to disk and GET tree includes the default volume/chapter/scene", async () => {
    const created = await postProject(jsonRequest("http://localhost/api/studio/projects", "POST", { title: "Harbor Night" }));
    const createdBody = await created.json();

    expect(created.status).toBe(201);
    expect(createdBody.data.project).toMatchObject({ id: "harbor-night", title: "Harbor Night", schemaVersion: 1 });

    const projectDir = path.join(getWorkspaceRoot(), "harbor-night");
    expect(existsSync(path.join(projectDir, "project.json"))).toBe(true);
    expect(existsSync(path.join(projectDir, "content", "volumes", "volume-01", "volume.json"))).toBe(true);
    expect(
      existsSync(path.join(projectDir, "content", "volumes", "volume-01", "chapters", "chapter-01", "chapter.json")),
    ).toBe(true);
    expect(
      existsSync(
        path.join(projectDir, "content", "volumes", "volume-01", "chapters", "chapter-01", "scenes", "scene-01.json"),
      ),
    ).toBe(true);

    const tree = await getTree(new Request("http://localhost/api/studio/projects/harbor-night/tree"), projectParams());
    const treeBody = await tree.json();

    expect(tree.status).toBe(200);
    expect(treeBody.data.volumes).toHaveLength(1);
    expect(treeBody.data.volumes[0]?.id).toBe("volume-01");
    expect(treeBody.data.volumes[0]?.chapters[0]?.id).toBe("chapter-01");
    expect(treeBody.data.volumes[0]?.chapters[0]?.scenes[0]).toMatchObject({
      id: "scene-01",
      title: "Untitled scene",
    });
    expect(treeBody.data.volumes[0]?.chapters[0]?.scenes[0]).not.toHaveProperty("script");
  });

  it("GET workspace lists the project without STORY_WORKSPACE_DB_PATH", async () => {
    expect(process.env.STORY_WORKSPACE_DB_PATH).toBeUndefined();

    await postProject(jsonRequest("http://localhost/api/studio/projects", "POST", { title: "Harbor Night" }));

    const response = await getWorkspace();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(process.env.STORY_WORKSPACE_DB_PATH).toBeUndefined();
    expect(body.data.root).toBe(getWorkspaceRoot());
    expect(body.data.projects).toEqual([
      expect.objectContaining({ id: "harbor-night", title: "Harbor Night" }),
    ]);
  });

  it("rejects a stale scene PATCH with EDIT_CONFLICT, then succeeds after reread", async () => {
    await postProject(jsonRequest("http://localhost/api/studio/projects", "POST", { title: "Harbor Night" }));

    const initial = await getScene(new Request("http://localhost/api/studio/scenes/scene-01"), sceneParams());
    const initialBody = await initial.json();
    const originalUpdatedAt = initialBody.data.scene.updatedAt as string;
    const scenePath = path.join(
      getWorkspaceRoot(),
      "harbor-night",
      "content",
      "volumes",
      "volume-01",
      "chapters",
      "chapter-01",
      "scenes",
      "scene-01.json",
    );

    const first = await patchScene(
      jsonRequest("http://localhost/api/studio/scenes/scene-01", "PATCH", {
        script: "First write",
        expectedUpdatedAt: originalUpdatedAt,
      }),
      sceneParams(),
    );
    const firstBody = await first.json();
    expect(first.status).toBe(200);
    expect(firstBody.data.scene.script).toBe("First write");
    const diskAfterFirst = readFileSync(scenePath, "utf8");

    const stale = await patchScene(
      jsonRequest("http://localhost/api/studio/scenes/scene-01", "PATCH", {
        script: "Stale write",
        expectedUpdatedAt: originalUpdatedAt,
      }),
      sceneParams(),
    );
    const staleBody = await stale.json();

    expect(stale.status).toBe(409);
    expect(staleBody.error.code).toBe("EDIT_CONFLICT");
    expect(staleBody.error.retryable).toBe(false);
    expect(staleBody.current).toMatchObject({ id: "scene-01", script: "First write" });
    expect(staleBody.error).not.toHaveProperty("currentChapter");
    expect(readFileSync(scenePath, "utf8")).toBe(diskAfterFirst);
    expect(JSON.parse(diskAfterFirst).script).toBe("First write");

    const latest = await getScene(new Request("http://localhost/api/studio/scenes/scene-01"), sceneParams());
    const latestBody = await latest.json();
    expect(latest.status).toBe(200);

    const retry = await patchScene(
      jsonRequest("http://localhost/api/studio/scenes/scene-01", "PATCH", {
        script: "Second write",
        expectedUpdatedAt: latestBody.data.scene.updatedAt,
      }),
      sceneParams(),
    );
    const retryBody = await retry.json();

    expect(retry.status).toBe(200);
    expect(retryBody.data.scene.script).toBe("Second write");
    expect(JSON.parse(readFileSync(scenePath, "utf8")).script).toBe("Second write");
  });

  it("POSTs entities and GET list filters by kind=character vs kind=location", async () => {
    await postProject(jsonRequest("http://localhost/api/studio/projects", "POST", { title: "Harbor Night" }));

    const jill = await postEntity(
      jsonRequest("http://localhost/api/studio/entities", "POST", { kind: "character", name: "Jill" }),
      projectParams(),
    );
    const dock = await postEntity(
      jsonRequest("http://localhost/api/studio/entities", "POST", { kind: "location", name: "Dock" }),
      projectParams(),
    );

    expect(jill.status).toBe(201);
    expect(dock.status).toBe(201);
    expect((await jill.json()).data.entity).toMatchObject({ id: "character-01", kind: "character", name: "Jill" });
    expect((await dock.json()).data.entity).toMatchObject({ id: "location-01", kind: "location", name: "Dock" });

    const characters = await getEntities(
      new Request("http://localhost/api/studio/projects/harbor-night/entities?kind=character"),
      projectParams(),
    );
    const locations = await getEntities(
      new Request("http://localhost/api/studio/projects/harbor-night/entities?kind=location"),
      projectParams(),
    );
    const characterBody = await characters.json();
    const locationBody = await locations.json();

    expect(characters.status).toBe(200);
    expect(locations.status).toBe(200);
    expect(characterBody.data.entities.map((entity: { id: string }) => entity.id)).toEqual(["character-01"]);
    expect(locationBody.data.entities.map((entity: { id: string }) => entity.id)).toEqual(["location-01"]);
  });

  it("returns 404 when reading another project's entity or scene", async () => {
    const alpha = await postProject(jsonRequest("http://localhost/api/studio/projects", "POST", { title: "Alpha Dock" }));
    const beta = await postProject(jsonRequest("http://localhost/api/studio/projects", "POST", { title: "Beta Harbor" }));
    const alphaId = (await alpha.json()).data.project.id as string;
    const betaId = (await beta.json()).data.project.id as string;

    const entity = await postEntity(
      jsonRequest("http://localhost/api/studio/entities", "POST", { kind: "character", name: "Jill", id: "jill" }),
      projectParams(alphaId),
    );
    expect(entity.status).toBe(201);

    const special = await postScene(
      jsonRequest("http://localhost/api/studio/scenes", "POST", { id: "scene-special", title: "Only in A" }),
      {
        params: Promise.resolve({ projectId: alphaId, volumeId: "volume-01", chapterId: "chapter-01" }),
      },
    );
    expect(special.status).toBe(201);

    const crossEntity = await getEntity(
      new Request(`http://localhost/api/studio/projects/${betaId}/entities/jill`),
      { params: Promise.resolve({ projectId: betaId, entityId: "jill" }) },
    );
    const crossEntityBody = await crossEntity.json();
    expect(crossEntity.status).toBe(404);
    expect(crossEntityBody.error.code).toBe("NOT_FOUND");

    const crossScene = await getScene(
      new Request(`http://localhost/api/studio/projects/${betaId}/scenes/scene-special`),
      sceneParams({ projectId: betaId, sceneId: "scene-special" }),
    );
    const crossSceneBody = await crossScene.json();
    expect(crossScene.status).toBe(404);
    expect(crossSceneBody.error.code).toBe("NOT_FOUND");
  });

  it("rejects path-traversal ids with VALIDATION_ERROR and never leaks outside paths", async () => {
    await postProject(jsonRequest("http://localhost/api/studio/projects", "POST", { title: "Harbor Night" }));

    const outsideDir = mkdtempSync(path.join(tmpdir(), "studio-http-outside-"));
    const secretPath = path.join(outsideDir, "secret.txt");
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(secretPath, "do-not-leak", "utf8");

    const attacks = ["../", "..\\", "C:", "C:\\Windows", "\\\\server\\share", "//server/share"];

    try {
      for (const id of attacks) {
        const projectResponse = await getProject(new Request("http://localhost/api/studio/projects/x"), {
          params: Promise.resolve({ projectId: id }),
        });
        const sceneResponse = await getScene(new Request("http://localhost/api/studio/scenes/x"), sceneParams({ sceneId: id }));
        const entityResponse = await getEntity(new Request("http://localhost/api/studio/entities/x"), {
          params: Promise.resolve({ projectId: "harbor-night", entityId: id }),
        });

        for (const response of [projectResponse, sceneResponse, entityResponse]) {
          const raw = await response.text();
          expect(response.status, id).toBe(400);
          expect(response.status, id).not.toBe(200);
          const body = JSON.parse(raw) as { error: { code: string; message: string } };
          expect(body.error.code, id).toBe("VALIDATION_ERROR");
          expect(raw).not.toContain(outsideDir);
          expect(raw).not.toContain(secretPath);
          expect(raw.toLowerCase()).not.toContain("do-not-leak");
          expect(body.error.message).not.toMatch(/[/\\]etc[/\\]passwd/);
          expect(body.error.message).not.toMatch(/Windows\\System32/i);
        }
      }
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("keeps two projects from polluting each other", async () => {
    const alpha = await postProject(jsonRequest("http://localhost/api/studio/projects", "POST", { title: "Alpha Dock" }));
    const beta = await postProject(jsonRequest("http://localhost/api/studio/projects", "POST", { title: "Beta Harbor" }));
    const alphaId = (await alpha.json()).data.project.id as string;
    const betaId = (await beta.json()).data.project.id as string;

    const alphaScene = await getScene(new Request("http://localhost/api/studio/scenes/scene-01"), sceneParams({ projectId: alphaId }));
    const alphaUpdatedAt = (await alphaScene.json()).data.scene.updatedAt as string;

    const patched = await patchScene(
      jsonRequest("http://localhost/api/studio/scenes/scene-01", "PATCH", {
        script: "Only alpha",
        expectedUpdatedAt: alphaUpdatedAt,
      }),
      sceneParams({ projectId: alphaId }),
    );
    expect(patched.status).toBe(200);

    const betaScene = await getScene(new Request("http://localhost/api/studio/scenes/scene-01"), sceneParams({ projectId: betaId }));
    const betaBody = await betaScene.json();
    expect(betaScene.status).toBe(200);
    expect(betaBody.data.scene.script).toBe("");

    const alphaTree = await getTree(new Request("http://localhost/api/studio/tree"), projectParams(alphaId));
    const betaTree = await getTree(new Request("http://localhost/api/studio/tree"), projectParams(betaId));
    expect((await alphaTree.json()).data.volumes[0]?.chapters[0]?.scenes).toHaveLength(1);
    expect((await betaTree.json()).data.volumes[0]?.chapters[0]?.scenes).toHaveLength(1);

    const root = getWorkspaceRoot();
    expect(existsSync(path.join(root, alphaId, "project.json"))).toBe(true);
    expect(existsSync(path.join(root, betaId, "project.json"))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(root, alphaId, "project.json"), "utf8")).title).toBe("Alpha Dock");
    expect(JSON.parse(readFileSync(path.join(root, betaId, "project.json"), "utf8")).title).toBe("Beta Harbor");
  });

  it("returns 400 when entity list is missing kind", async () => {
    await postProject(jsonRequest("http://localhost/api/studio/projects", "POST", { title: "Harbor Night" }));

    const response = await getEntities(
      new Request("http://localhost/api/studio/projects/harbor-night/entities"),
      projectParams(),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fieldErrors.kind).toBeDefined();
  });

  it("returns 409 ID_CONFLICT for a duplicate custom entity or volume id", async () => {
    await postProject(jsonRequest("http://localhost/api/studio/projects", "POST", { title: "Harbor Night" }));

    const volume = await postVolume(
      jsonRequest("http://localhost/api/studio/volumes", "POST", { id: "volume-custom", title: "Custom volume" }),
      projectParams(),
    );
    expect(volume.status).toBe(201);

    const duplicateVolume = await postVolume(
      jsonRequest("http://localhost/api/studio/volumes", "POST", { id: "volume-custom", title: "Again" }),
      projectParams(),
    );
    const duplicateVolumeBody = await duplicateVolume.json();
    expect(duplicateVolume.status).toBe(409);
    expect(duplicateVolumeBody.error.code).toBe("ID_CONFLICT");
    expect(duplicateVolumeBody.error.retryable).toBe(false);

    const entity = await postEntity(
      jsonRequest("http://localhost/api/studio/entities", "POST", { kind: "character", name: "Jill", id: "shared-id" }),
      projectParams(),
    );
    expect(entity.status).toBe(201);

    const duplicateEntity = await postEntity(
      jsonRequest("http://localhost/api/studio/entities", "POST", { kind: "location", name: "Dock", id: "shared-id" }),
      projectParams(),
    );
    const duplicateEntityBody = await duplicateEntity.json();
    expect(duplicateEntity.status).toBe(409);
    expect(duplicateEntityBody.error.code).toBe("ID_CONFLICT");
  });

  it("returns 400 VALIDATION_ERROR for invalid JSON bodies", async () => {
    const response = await postProject(
      new Request("http://localhost/api/studio/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.retryable).toBe(false);
  });

  it("directs a scene, lists shots, patches a shot, and returns a context snapshot", async () => {
    await postProject(jsonRequest("http://localhost/api/studio/projects", "POST", { title: "Harbor Night" }));
    await postEntity(
      jsonRequest("http://localhost/api/studio/entities", "POST", { kind: "character", name: "Jill" }),
      projectParams(),
    );
    await postEntity(
      jsonRequest("http://localhost/api/studio/entities", "POST", { kind: "location", name: "Dock" }),
      projectParams(),
    );

    const initial = await getScene(new Request("http://localhost/api/studio/scenes/scene-01"), sceneParams());
    const initialBody = await initial.json();
    await patchScene(
      jsonRequest("http://localhost/api/studio/scenes/scene-01", "PATCH", {
        script: "Jill waits under a lantern.\n\nShe looks toward the water.",
        intent: "Establish Jill waiting for a signal.",
        characters: ["character-01"],
        location: "location-01",
        expectedUpdatedAt: initialBody.data.scene.updatedAt,
      }),
      sceneParams(),
    );

    const directed = await postDirector(
      jsonRequest("http://localhost/api/studio/scenes/scene-01/director", "POST", {}),
      sceneParams(),
    );
    const directedBody = await directed.json();
    expect(directed.status).toBe(200);
    expect(directedBody.data.scene.shots.length).toBeGreaterThanOrEqual(2);

    const listed = await getShots(new Request("http://localhost/api/studio/scenes/scene-01/shots"), sceneParams());
    const listedBody = await listed.json();
    expect(listed.status).toBe(200);
    expect(listedBody.data.shots).toHaveLength(directedBody.data.scene.shots.length);

    const first = listedBody.data.shots[0] as { id: string; updatedAt: string };
    const patched = await patchShot(
      jsonRequest("http://localhost/api/studio/shots/shot-01", "PATCH", {
        purpose: "HTTP patched purpose",
        expectedUpdatedAt: first.updatedAt,
      }),
      shotParams(first.id),
    );
    const patchedBody = await patched.json();
    expect(patched.status).toBe(200);
    expect(patchedBody.data.shot.purpose).toBe("HTTP patched purpose");

    const secondId = listedBody.data.shots[1]?.id as string;
    const context = await getContext(
      new Request(`http://localhost/api/studio/scenes/scene-01/context?shotId=${secondId}`),
      sceneParams(),
    );
    const contextBody = await context.json();
    expect(context.status).toBe(200);
    expect(contextBody.data.snapshot).toMatchObject({
      intent: "Establish Jill waiting for a signal.",
      shot: { id: secondId },
      continuity: { from: first.id },
    });
    expect(contextBody.data.snapshot.entities.map((entity: { id: string }) => entity.id)).toEqual([
      "character-01",
      "location-01",
    ]);
  });

  it("DELETEs a scene, chapter, and volume and removes them from the tree", async () => {
    await postProject(jsonRequest("http://localhost/api/studio/projects", "POST", { title: "Harbor Night" }));

    const secondScene = await postScene(
      jsonRequest("http://localhost/api/studio/scenes", "POST", { title: "Second scene" }),
      {
        params: Promise.resolve({
          projectId: "harbor-night",
          volumeId: "volume-01",
          chapterId: "chapter-01",
        }),
      },
    );
    const secondSceneBody = await secondScene.json();
    expect(secondScene.status).toBe(201);
    const secondSceneId = secondSceneBody.data.scene.id as string;

    const deletedScene = await deleteScene(
      new Request(`http://localhost/api/studio/scenes/${secondSceneId}`, { method: "DELETE" }),
      sceneParams({ sceneId: secondSceneId }),
    );
    const deletedSceneBody = await deletedScene.json();
    expect(deletedScene.status).toBe(200);
    expect(deletedSceneBody.data).toEqual({ deleted: true });

    let tree = await getTree(new Request("http://localhost/api/studio/projects/harbor-night/tree"), projectParams());
    let treeBody = await tree.json();
    expect(treeBody.data.volumes[0]?.chapters[0]?.scenes.map((scene: { id: string }) => scene.id)).toEqual([
      "scene-01",
    ]);

    const chapter = await postChapter(
      jsonRequest("http://localhost/api/studio/chapters", "POST", { title: "Chapter 2" }),
      {
        params: Promise.resolve({ projectId: "harbor-night", volumeId: "volume-01" }),
      },
    );
    const chapterBody = await chapter.json();
    expect(chapter.status).toBe(201);
    const chapterId = chapterBody.data.chapter.id as string;

    const deletedChapter = await deleteChapter(
      new Request(`http://localhost/api/studio/chapters/${chapterId}`, { method: "DELETE" }),
      {
        params: Promise.resolve({
          projectId: "harbor-night",
          volumeId: "volume-01",
          chapterId,
        }),
      },
    );
    const deletedChapterBody = await deletedChapter.json();
    expect(deletedChapter.status).toBe(200);
    expect(deletedChapterBody.data).toEqual({ deleted: true });

    tree = await getTree(new Request("http://localhost/api/studio/projects/harbor-night/tree"), projectParams());
    treeBody = await tree.json();
    expect(treeBody.data.volumes[0]?.chapters.map((item: { id: string }) => item.id)).toEqual(["chapter-01"]);

    const volume = await postVolume(
      jsonRequest("http://localhost/api/studio/volumes", "POST", { title: "Volume 2" }),
      projectParams(),
    );
    const volumeBody = await volume.json();
    expect(volume.status).toBe(201);
    const volumeId = volumeBody.data.volume.id as string;

    const deletedVolume = await deleteVolume(
      new Request(`http://localhost/api/studio/volumes/${volumeId}`, { method: "DELETE" }),
      {
        params: Promise.resolve({ projectId: "harbor-night", volumeId }),
      },
    );
    const deletedVolumeBody = await deletedVolume.json();
    expect(deletedVolume.status).toBe(200);
    expect(deletedVolumeBody.data).toEqual({ deleted: true });

    tree = await getTree(new Request("http://localhost/api/studio/projects/harbor-night/tree"), projectParams());
    treeBody = await tree.json();
    expect(treeBody.data.volumes.map((item: { id: string }) => item.id)).toEqual(["volume-01"]);
  });

  it("returns 404 for missing story nodes and 400 for illegal ids without leaking outside paths", async () => {
    await postProject(jsonRequest("http://localhost/api/studio/projects", "POST", { title: "Harbor Night" }));

    const missingScene = await deleteScene(
      new Request("http://localhost/api/studio/scenes/scene-missing", { method: "DELETE" }),
      sceneParams({ sceneId: "scene-missing" }),
    );
    const missingSceneBody = await missingScene.json();
    expect(missingScene.status).toBe(404);
    expect(missingSceneBody.error.code).toBe("NOT_FOUND");

    const missingChapter = await deleteChapter(
      new Request("http://localhost/api/studio/chapters/chapter-missing", { method: "DELETE" }),
      {
        params: Promise.resolve({
          projectId: "harbor-night",
          volumeId: "volume-01",
          chapterId: "chapter-missing",
        }),
      },
    );
    expect(missingChapter.status).toBe(404);
    expect((await missingChapter.json()).error.code).toBe("NOT_FOUND");

    const missingVolume = await deleteVolume(
      new Request("http://localhost/api/studio/volumes/volume-missing", { method: "DELETE" }),
      {
        params: Promise.resolve({ projectId: "harbor-night", volumeId: "volume-missing" }),
      },
    );
    expect(missingVolume.status).toBe(404);
    expect((await missingVolume.json()).error.code).toBe("NOT_FOUND");

    const outsideDir = mkdtempSync(path.join(tmpdir(), "studio-http-delete-outside-"));
    const secretPath = path.join(outsideDir, "secret.txt");
    writeFileSync(secretPath, "do-not-leak", "utf8");

    try {
      const badId = "../";
      const response = await deleteScene(
        new Request("http://localhost/api/studio/scenes/x", { method: "DELETE" }),
        sceneParams({ sceneId: badId }),
      );
      const raw = await response.text();
      expect(response.status).toBe(400);
      const body = JSON.parse(raw) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(raw).not.toContain(outsideDir);
      expect(raw).not.toContain(secretPath);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function projectParams(projectId = "harbor-night") {
  return { params: Promise.resolve({ projectId }) };
}

function sceneParams(
  overrides: {
    projectId?: string;
    volumeId?: string;
    chapterId?: string;
    sceneId?: string;
  } = {},
) {
  return {
    params: Promise.resolve({
      projectId: "harbor-night",
      volumeId: "volume-01",
      chapterId: "chapter-01",
      sceneId: "scene-01",
      ...overrides,
    }),
  };
}

function shotParams(shotId: string) {
  return {
    params: Promise.resolve({
      projectId: "harbor-night",
      volumeId: "volume-01",
      chapterId: "chapter-01",
      sceneId: "scene-01",
      shotId,
    }),
  };
}
