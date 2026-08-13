import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "@/server/db/projects";
import { createDocument, getDocumentRevision } from "@/server/db/document";

let databaseDirectory = "";

function jsonRequest(url: string, body: unknown) {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function context<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

describe("Phase 4 Context Snapshot routes", () => {
  beforeEach(() => {
    databaseDirectory = mkdtempSync(join(tmpdir(), "story-phase4-api-"));
    process.env.STORY_WORKSPACE_DB_PATH = join(databaseDirectory, "story.db");
  });

  afterEach(async () => {
    const { closeDatabase } = await import("@/server/db/connection");
    closeDatabase();
    delete process.env.STORY_WORKSPACE_DB_PATH;
    rmSync(databaseDirectory, { recursive: true, force: true });
  });

  it("builds and reads strict project-scoped Snapshot envelopes", async () => {
    const project = createProject({ title: "Context routes" });
    const foreignProject = createProject({ title: "Foreign context" });
    const document = createDocument(project.id, { title: "Script", requestId: "phase4-route-document", scenes: [{ title: "One", content: "A quiet room." }] });
    const revision = getDocumentRevision(document.currentRevisionId as string, project.id);
    const scene = revision?.sceneRevisions[0];
    if (!scene) throw new Error("scene revision missing");

    const { POST: build } = await import("./projects/[projectId]/contexts/build/route");
    const builtResponse = await build(jsonRequest("http://localhost/api/contexts/build", { sceneId: scene.sceneId, sceneRevisionId: scene.id, purpose: "storyboard", policyId: "storyboard-default-v1", allowInferred: false, requestId: "phase4-route-build" }), context({ projectId: project.id }));
    expect(builtResponse.status).toBe(201);
    const builtData = (await builtResponse.json()).data as { snapshot: { id: string; sceneRevisionId: string }; idempotent: boolean };
    expect(builtData).toMatchObject({ idempotent: false, snapshot: { sceneRevisionId: scene.id } });

    const { GET: list } = await import("./projects/[projectId]/contexts/route");
    const listResponse = await list(new Request(`http://localhost/api/contexts?sceneId=${scene.sceneId}&sceneRevisionId=${scene.id}&purpose=storyboard&policyId=storyboard-default-v1&latest=true`), context({ projectId: project.id }));
    expect(listResponse.status).toBe(200);
    expect((await listResponse.json()).data).toMatchObject({ snapshots: [{ id: builtData.snapshot.id }] });
    const unknownQuery = await list(new Request("http://localhost/api/contexts?unknown=value"), context({ projectId: project.id }));
    expect(unknownQuery.status).toBe(400);

    const { GET: get } = await import("./projects/[projectId]/contexts/[contextId]/route");
    const getResponse = await get(new Request("http://localhost"), context({ projectId: project.id, contextId: builtData.snapshot.id }));
    expect(getResponse.status).toBe(200);
    expect((await getResponse.json()).data).toMatchObject({ snapshot: { id: builtData.snapshot.id } });
    const foreignResponse = await get(new Request("http://localhost"), context({ projectId: foreignProject.id, contextId: builtData.snapshot.id }));
    expect(foreignResponse.status).toBe(404);
  });
});
