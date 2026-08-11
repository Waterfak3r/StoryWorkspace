import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "@/server/db/projects";
import { createDocument, createDocumentRevision, getDocumentRevision } from "@/server/db/document";
import { createEntity } from "@/server/db/story-bible";

let databaseDirectory = "";

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function context<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

describe("Phase 2 Canon Patch routes", () => {
  beforeEach(() => {
    databaseDirectory = mkdtempSync(join(tmpdir(), "story-phase2-api-"));
    process.env.STORY_WORKSPACE_DB_PATH = join(databaseDirectory, "story.db");
  });

  afterEach(async () => {
    const { closeDatabase } = await import("@/server/db/connection");
    closeDatabase();
    delete process.env.STORY_WORKSPACE_DB_PATH;
    rmSync(databaseDirectory, { recursive: true, force: true });
  });

  it("proposes, reviews, accepts and returns complete provenance", async () => {
    const project = createProject({ title: "Routes" });
    const character = createEntity(project.id, { type: "character", canonicalName: "林默" });
    const content = "林默佩戴银色耳钉。";
    const document = createDocument(project.id, { title: "Script", requestId: "document", scenes: [{ title: "One", content }] });
    const scene = getDocumentRevision(document.currentRevisionId as string, project.id)?.sceneRevisions[0];
    if (!scene) throw new Error("scene missing");
    const { POST: propose } = await import("./projects/[projectId]/scenes/[sceneId]/fact-patches/route");
    const proposalResponse = await propose(jsonRequest("http://localhost", "POST", { documentId: document.id, sceneRevisionId: scene.id, operation: "add_fact", subjectEntityId: character.id, predicate: "appearance.distinctive_features", value: ["银色耳钉"], valueType: "json", scope: "base", evidence: [{ anchorStart: 4, anchorEnd: 8, quotedText: "银色耳钉" }], requestId: "route-proposal" }), context({ projectId: project.id, sceneId: scene.sceneId }));
    expect(proposalResponse.status).toBe(201);
    const proposal = (await proposalResponse.json()).data as { patch: { id: string; version: number } };
    const { GET: list } = await import("./projects/[projectId]/patches/route");
    expect((await list(new Request("http://localhost?status=pending"), context({ projectId: project.id }))).status).toBe(200);
    const { GET: review } = await import("./projects/[projectId]/scenes/[sceneId]/patch-review/route");
    const reviewResponse = await review(new Request(`http://localhost?sceneRevisionId=${scene.id}`), context({ projectId: project.id, sceneId: scene.sceneId }));
    expect(reviewResponse.status).toBe(200);
    expect((await reviewResponse.json()).data).toMatchObject({ patches: [{ id: proposal.patch.id }], inferences: [{ status: "active" }], modelRuns: [{ status: "succeeded" }], evidenceSources: [{ sceneRevisionId: scene.id }] });
    const { POST: accept } = await import("./projects/[projectId]/patches/[patchId]/accept/route");
    const accepted = await accept(jsonRequest("http://localhost", "POST", { expectedVersion: proposal.patch.version, requestId: "route-accept" }), context({ projectId: project.id, patchId: proposal.patch.id }));
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).data.fact.truthClass).toBe("canon");
    const replay = await accept(jsonRequest("http://localhost", "POST", { expectedVersion: proposal.patch.version, requestId: "route-accept" }), context({ projectId: project.id, patchId: proposal.patch.id }));
    expect((await replay.json()).data.application).toMatchObject({ patchId: proposal.patch.id });
  });

  it("rejects invalid status, stale review, and foreign patch reads", async () => {
    const project = createProject({ title: "Routes" });
    const foreign = createProject({ title: "Foreign" });
    const character = createEntity(project.id, { type: "character", canonicalName: "林默" });
    const document = createDocument(project.id, { title: "Script", requestId: "document", scenes: [{ title: "One", content: "林默。" }] });
    const scene = getDocumentRevision(document.currentRevisionId as string, project.id)?.sceneRevisions[0];
    if (!scene) throw new Error("scene missing");
    const { GET: list } = await import("./projects/[projectId]/patches/route");
    expect((await list(new Request("http://localhost?status=bogus"), context({ projectId: project.id }))).status).toBe(400);
    const { POST: propose } = await import("./projects/[projectId]/scenes/[sceneId]/fact-patches/route");
    const proposalResponse = await propose(jsonRequest("http://localhost", "POST", { documentId: document.id, sceneRevisionId: scene.id, operation: "add_fact", subjectEntityId: character.id, predicate: "appearance.face", value: "冷峻", valueType: "string", scope: "base", evidence: [{ anchorStart: 0, anchorEnd: 2, quotedText: "林默" }], requestId: "stale" }), context({ projectId: project.id, sceneId: scene.sceneId }));
    const proposal = (await proposalResponse.json()).data.patch as { id: string };
    const { GET: patch } = await import("./projects/[projectId]/patches/[patchId]/route");
    expect((await patch(new Request("http://localhost"), context({ projectId: foreign.id, patchId: proposal.id }))).status).toBe(404);
    const { GET: review } = await import("./projects/[projectId]/scenes/[sceneId]/patch-review/route");
    createDocumentRevision(document.id, { baseVersion: document.version, requestId: "new", scenes: [{ id: scene.sceneId, title: "One", content: "没人。" }] });
    expect((await review(new Request(`http://localhost?sceneRevisionId=${scene.id}`), context({ projectId: project.id, sceneId: scene.sceneId }))).status).toBe(409);
  });
});
