import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { POST as createProjectRoute } from "@/app/api/studio/projects/route";
import { PATCH as patchSceneRoute } from "@/app/api/studio/projects/[projectId]/volumes/[volumeId]/chapters/[chapterId]/scenes/[sceneId]/route";
import { GET as getSceneRoute } from "@/app/api/studio/projects/[projectId]/volumes/[volumeId]/chapters/[chapterId]/scenes/[sceneId]/route";
import { POST as createEntityRoute } from "@/app/api/studio/projects/[projectId]/entities/route";
import { GET as getProjectRoute } from "@/app/api/studio/projects/[projectId]/route";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;

let workspaceRoot = "";

function listFiles(dir: string, prefix = ""): string[] {
  const names = readdirSync(dir).sort();
  const out: string[] = [];
  for (const name of names) {
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) {
      out.push(`${rel}/`);
      out.push(...listFiles(full, rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

function sceneParams(projectId: string) {
  return {
    params: Promise.resolve({
      projectId,
      volumeId: "volume-01",
      chapterId: "chapter-01",
      sceneId: "scene-01",
    }),
  };
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-persist-evidence-"));
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

describe("persist evidence via shipped HTTP routes", () => {
  it("creates a JSON project, persists script and entities, rejects stale writes and traversal", async () => {
    expect(process.env.STORY_WORKSPACE_DB_PATH).toBeUndefined();

    const created = await createProjectRoute(
      new Request("http://localhost/api/studio/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Harbor Night" }),
      }),
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { data: { project: { id: string; title: string } } };
    const projectId = createdBody.data.project.id;
    expect(projectId).toBe("harbor-night");
    expect(createdBody.data.project.title).toBe("Harbor Night");

    const projectDir = path.join(workspaceRoot, projectId);
    const files = listFiles(projectDir);
    const required = [
      "project.json",
      "content/volumes/volume-01/volume.json",
      "content/volumes/volume-01/chapters/chapter-01/chapter.json",
      "content/volumes/volume-01/chapters/chapter-01/scenes/scene-01.json",
      "styles/default.json",
    ];
    for (const file of required) {
      expect(files).toContain(file);
    }

    const opened = await getProjectRoute(new Request(`http://localhost/api/studio/projects/${projectId}`), {
      params: Promise.resolve({ projectId }),
    });
    expect(opened.status).toBe(200);

    const sceneRes = await getSceneRoute(new Request("http://localhost/scene"), sceneParams(projectId));
    const sceneBody = (await sceneRes.json()) as { data: { scene: { updatedAt: string } } };

    const script = "Lanterns cut the fog along the quay.";
    const intent = "Open on the harbor at night.";
    const patched = await patchSceneRoute(
      new Request("http://localhost/scene", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          script,
          intent,
          expectedUpdatedAt: sceneBody.data.scene.updatedAt,
        }),
      }),
      sceneParams(projectId),
    );
    expect(patched.status).toBe(200);

    const sceneDisk = JSON.parse(
      readFileSync(path.join(projectDir, "content/volumes/volume-01/chapters/chapter-01/scenes/scene-01.json"), "utf8"),
    ) as { script: string; intent: string; updatedAt: string };
    expect(sceneDisk.script).toBe(script);
    expect(sceneDisk.intent).toBe(intent);

    const stale = await patchSceneRoute(
      new Request("http://localhost/scene", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          script: "THIS SHOULD NOT WIN",
          expectedUpdatedAt: sceneBody.data.scene.updatedAt,
        }),
      }),
      sceneParams(projectId),
    );
    expect(stale.status).toBe(409);
    const staleBody = (await stale.json()) as { error: { code: string }; current: { script: string } };
    expect(staleBody.error.code).toBe("EDIT_CONFLICT");
    expect(staleBody.current.script).toBe(script);
    const sceneAfterConflict = JSON.parse(
      readFileSync(path.join(projectDir, "content/volumes/volume-01/chapters/chapter-01/scenes/scene-01.json"), "utf8"),
    ) as { script: string };
    expect(sceneAfterConflict.script).toBe(script);

    const character = await createEntityRoute(
      new Request(`http://localhost/api/studio/projects/${projectId}/entities`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "character", name: "Jill" }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const location = await createEntityRoute(
      new Request(`http://localhost/api/studio/projects/${projectId}/entities`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "location", name: "Harbor" }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    expect(character.status).toBe(201);
    expect(location.status).toBe(201);
    const characterBody = (await character.json()) as { data: { entity: { id: string; name: string } } };
    const locationBody = (await location.json()) as { data: { entity: { id: string; name: string } } };
    const characterDisk = JSON.parse(
      readFileSync(path.join(projectDir, "entities/characters", `${characterBody.data.entity.id}.json`), "utf8"),
    ) as { name: string };
    const locationDisk = JSON.parse(
      readFileSync(path.join(projectDir, "entities/locations", `${locationBody.data.entity.id}.json`), "utf8"),
    ) as { name: string };
    expect(characterDisk.name).toBe("Jill");
    expect(locationDisk.name).toBe("Harbor");

    const traversal = await getProjectRoute(new Request("http://localhost/api/studio/projects/../secret"), {
      params: Promise.resolve({ projectId: "../secret" }),
    });
    expect(traversal.status).toBe(400);
    const traversalBody = (await traversal.json()) as { error: { code: string; message: string } };
    expect(traversalBody.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(traversalBody)).not.toMatch(/[A-Za-z]:\\/);
    expect(JSON.stringify(traversalBody)).not.toContain("secret.txt");

    const jsonFiles = listFiles(projectDir).filter((name) => name.endsWith(".json"));
    for (const file of jsonFiles) {
      const raw = readFileSync(path.join(projectDir, file), "utf8");
      expect(raw).not.toMatch(/sk-[A-Za-z0-9]/);
      expect(raw).not.toMatch(/API_KEY/);
    }

    console.log(
      JSON.stringify(
        {
          dbPathSet: process.env.STORY_WORKSPACE_DB_PATH !== undefined,
          workspaceRoot,
          projectId,
          files,
          sceneScript: sceneDisk.script,
          sceneIntent: sceneDisk.intent,
          character: characterDisk.name,
          location: locationDisk.name,
          staleStatus: stale.status,
          staleCode: staleBody.error.code,
          traversalStatus: traversal.status,
        },
        null,
        2,
      ),
    );
  });
});
