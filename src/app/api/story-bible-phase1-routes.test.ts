import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "@/server/db/projects";
import { createDocument, createDocumentRevision, getDocumentRevision } from "@/server/db/document";
import { createEntity } from "@/server/db/story-bible";
import { listSceneEntityLinks } from "@/server/db/scene-link";

let databaseDirectory = "";

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function context<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

describe("Phase 1 analysis and scene-link routes", () => {
  beforeEach(() => {
    databaseDirectory = mkdtempSync(join(tmpdir(), "story-phase1-api-"));
    process.env.STORY_WORKSPACE_DB_PATH = join(databaseDirectory, "story.db");
  });

  afterEach(async () => {
    const { closeDatabase } = await import("@/server/db/connection");
    closeDatabase();
    delete process.env.STORY_WORKSPACE_DB_PATH;
    rmSync(databaseDirectory, { recursive: true, force: true });
  });

  it("enqueues, executes, reads evidence review, and applies a project-scoped CAS review", async () => {
    const project = createProject({ title: "Analysis routes" });
    const foreignProject = createProject({ title: "Foreign" });
    createEntity(project.id, { type: "character", canonicalName: "Alice" });
    const document = createDocument(project.id, { title: "Script", requestId: "document", scenes: [{ title: "One", content: "Alice enters." }] });
    const revision = getDocumentRevision(document.currentRevisionId as string, project.id);
    const scene = revision?.sceneRevisions[0];
    if (!scene) throw new Error("scene revision missing");

    const { POST: enqueue } = await import("./projects/[projectId]/scenes/[sceneId]/analysis-runs/route");
    const queuedResponse = await enqueue(jsonRequest("http://localhost", "POST", { documentId: document.id, sceneId: scene.sceneId, sceneRevisionId: scene.id, requestId: "route-analysis" }), context({ projectId: project.id, sceneId: scene.sceneId }));
    expect(queuedResponse.status).toBe(202);
    const queued = (await queuedResponse.json()).data.run as { id: string };

    const { POST: execute } = await import("./projects/[projectId]/analysis/runs/[runId]/execute/route");
    const executedResponse = await execute(jsonRequest("http://localhost", "POST", {}), context({ projectId: project.id, runId: queued.id }));
    expect(executedResponse.status).toBe(200);
    expect((await executedResponse.json()).data.run.status).toBe("succeeded");

    const { GET: review } = await import("./projects/[projectId]/scenes/[sceneId]/entity-review/route");
    const reviewResponse = await review(new Request(`http://localhost?sceneRevisionId=${scene.id}`), context({ projectId: project.id, sceneId: scene.sceneId }));
    expect(reviewResponse.status).toBe(200);
    const reviewData = (await reviewResponse.json()).data.review as { mentions: Array<{ evidenceSourceId: string }>; evidenceSources: Array<{ id: string }>; links: Array<{ id: string; version: number; status: string }> };
    expect(reviewData.mentions).toHaveLength(1);
    expect(reviewData.evidenceSources.map((source) => source.id)).toEqual([reviewData.mentions[0].evidenceSourceId]);
    expect(reviewData.links).toHaveLength(1);

    const link = reviewData.links[0];
    const { PATCH: reviewLink } = await import("./projects/[projectId]/scenes/[sceneId]/entity-links/[linkId]/route");
    const rejectedResponse = await reviewLink(jsonRequest("http://localhost", "PATCH", { status: "rejected", expectedVersion: link.version, expectedSceneRevisionId: scene.id, requestId: "route-review" }), context({ projectId: project.id, sceneId: scene.sceneId, linkId: link.id }));
    expect(rejectedResponse.status).toBe(200);
    expect((await rejectedResponse.json()).data.link.status).toBe("rejected");
    const casResponse = await reviewLink(jsonRequest("http://localhost", "PATCH", { status: "confirmed", expectedVersion: link.version, expectedSceneRevisionId: scene.id, requestId: "route-review-stale" }), context({ projectId: project.id, sceneId: scene.sceneId, linkId: link.id }));
    expect(casResponse.status).toBe(409);

    createDocumentRevision(document.id, { baseVersion: document.version, requestId: "route-new-revision", scenes: [{ id: scene.sceneId, title: "One", content: "Nobody." }] });
    const currentReviewResponse = await review(new Request("http://localhost"), context({ projectId: project.id, sceneId: scene.sceneId }));
    expect(currentReviewResponse.status).toBe(200);
    expect((await currentReviewResponse.json()).data.review).toMatchObject({ runs: [], mentions: [], links: [], evidenceSources: [] });

    const { GET: foreignReview } = await import("./projects/[projectId]/scenes/[sceneId]/entity-review/route");
    expect((await foreignReview(new Request("http://localhost"), context({ projectId: foreignProject.id, sceneId: scene.sceneId }))).status).toBe(404);
    const { GET: foreignLink } = await import("./projects/[projectId]/scenes/[sceneId]/entity-links/[linkId]/route");
    expect((await foreignLink(new Request("http://localhost"), context({ projectId: foreignProject.id, sceneId: scene.sceneId, linkId: link.id }))).status).toBe(404);
    expect(listSceneEntityLinks(project.id, scene.sceneId, { sceneRevisionId: scene.id })[0]?.status).toBe("rejected");
  });

  it("rejects an idempotency key reused for a different current scene input", async () => {
    const project = createProject({ title: "Idempotency routes" });
    const firstDocument = createDocument(project.id, { title: "First", requestId: "document-first", scenes: [{ title: "One", content: "First." }] });
    const firstScene = getDocumentRevision(firstDocument.currentRevisionId as string, project.id)?.sceneRevisions[0];
    const secondDocument = createDocument(project.id, { title: "Second", requestId: "document-second", scenes: [{ title: "Two", content: "Second." }] });
    const secondScene = getDocumentRevision(secondDocument.currentRevisionId as string, project.id)?.sceneRevisions[0];
    if (!firstScene || !secondScene) throw new Error("scene revision missing");
    const { POST: enqueue } = await import("./projects/[projectId]/analysis/route");
    expect((await enqueue(jsonRequest("http://localhost", "POST", { documentId: firstDocument.id, sceneId: firstScene.sceneId, sceneRevisionId: firstScene.id, requestId: "same-key" }), context({ projectId: project.id }))).status).toBe(202);
    const conflict = await enqueue(jsonRequest("http://localhost", "POST", { documentId: secondDocument.id, sceneId: secondScene.sceneId, sceneRevisionId: secondScene.id, requestId: "same-key" }), context({ projectId: project.id }));
    expect(conflict.status).toBe(409);
  });
});
