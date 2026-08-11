import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "@/server/db/projects";

let databaseDirectory = "";

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function context<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

describe("Phase 0 Story Bible routes", () => {
  beforeEach(() => {
    databaseDirectory = mkdtempSync(join(tmpdir(), "story-phase0-api-"));
    process.env.STORY_WORKSPACE_DB_PATH = join(databaseDirectory, "story.db");
  });

  afterEach(async () => {
    const { closeDatabase } = await import("@/server/db/connection");
    closeDatabase();
    delete process.env.STORY_WORKSPACE_DB_PATH;
    rmSync(databaseDirectory, { recursive: true, force: true });
  });

  it("creates a document, preserves scene IDs on revision reorder, and reports stale bases", async () => {
    const project = createProject({ title: "Document routes" });
    const { POST: postDocument } = await import("./projects/[projectId]/documents/route");
    const response = await postDocument(jsonRequest("http://localhost/api/documents", "POST", { title: "Script", requestId: "doc-create", scenes: [{ title: "One", content: "A" }, { title: "Two", content: "B" }] }), context({ projectId: project.id }));
    expect(response.status).toBe(201);
    const document = (await response.json()).data.document as { id: string; version: number };
    const { GET: getScenes } = await import("./documents/[documentId]/scenes/route");
    const scenes = (await (await getScenes(new Request(`http://localhost?projectId=${project.id}`), context({ documentId: document.id }))).json()).data.scenes as Array<{ id: string }>;
    const { POST: postRevision } = await import("./documents/[documentId]/revisions/route");
    const revisionResponse = await postRevision(jsonRequest(`http://localhost/api/revisions?projectId=${project.id}`, "POST", { baseVersion: document.version, requestId: "revision-1", scenes: [{ id: scenes[1].id, title: "Two", content: "B" }, { id: scenes[0].id, title: "One", content: "A" }] }), context({ documentId: document.id }));
    expect(revisionResponse.status).toBe(201);
    const stale = await postRevision(jsonRequest(`http://localhost/api/revisions?projectId=${project.id}`, "POST", { baseVersion: document.version, requestId: "revision-stale", scenes: [] }), context({ documentId: document.id }));
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toMatchObject({ code: "EDIT_CONFLICT", currentDocument: expect.any(Object) });
  });

  it("rejects cross-project entity aliases and accepts a superseding fact", async () => {
    const projectA = createProject({ title: "A" });
    const projectB = createProject({ title: "B" });
    const { POST: createEntityRoute } = await import("./projects/[projectId]/entities/route");
    const entityResponse = await createEntityRoute(jsonRequest("http://localhost", "POST", { type: "character", canonicalName: "A", requestId: "entity" }), context({ projectId: projectA.id }));
    const entity = (await entityResponse.json()).data.entity as { id: string };
    const { POST: createAliasRoute } = await import("./projects/[projectId]/entities/[entityId]/aliases/route");
    const foreignAlias = await createAliasRoute(jsonRequest("http://localhost", "POST", { alias: "Alias", requestId: "alias" }), context({ projectId: projectB.id, entityId: entity.id }));
    expect(foreignAlias.status).toBe(404);

    const { POST: createSourceRoute } = await import("./projects/[projectId]/evidence-sources/route");
    const source = (await (await createSourceRoute(jsonRequest("http://localhost", "POST", { kind: "user_input", requestId: "source" }), context({ projectId: projectA.id }))).json()).data.source as { id: string };
    const { POST: createFactRoute } = await import("./projects/[projectId]/facts/route");
    const fact = (await (await createFactRoute(jsonRequest("http://localhost", "POST", { subjectEntityId: entity.id, predicate: "appearance.hair", value: "black", valueType: "string", scope: "base", sourceId: source.id, requestId: "fact" }), context({ projectId: projectA.id }))).json()).data.fact as { id: string; version: number };
    const { POST: supersedeRoute } = await import("./facts/[factId]/supersede/route");
    const missingScope = await supersedeRoute(jsonRequest("http://localhost", "POST", { value: "silver", valueType: "string", sourceId: source.id, expectedVersion: fact.version, requestId: "fact-missing-scope" }), context({ factId: fact.id }));
    expect(missingScope.status).toBe(400);
    const wrongScope = await supersedeRoute(jsonRequest(`http://localhost?projectId=${projectB.id}`, "POST", { value: "silver", valueType: "string", sourceId: source.id, expectedVersion: fact.version, requestId: "fact-wrong-scope" }), context({ factId: fact.id }));
    expect(wrongScope.status).toBe(404);
    const superseded = await supersedeRoute(jsonRequest(`http://localhost?projectId=${projectA.id}`, "POST", { value: "silver", valueType: "string", sourceId: source.id, expectedVersion: fact.version, requestId: "fact-2" }), context({ factId: fact.id }));
    expect(superseded.status).toBe(201);
    expect((await superseded.json()).data.fact.supersedesFactId).toBe(fact.id);
  });
});
