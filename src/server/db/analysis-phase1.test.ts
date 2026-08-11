import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDatabase } from "./connection";
import { createDocument, createDocumentRevision, getDocumentRevision, getSceneRevision } from "./document";
import { analyzeSceneText, enqueueAnalysisRun, executeAnalysisRun } from "./analysis";
import { listEntityMentions, listSceneEntityLinks, projectAnalysisCandidates, reviewSceneEntityLink } from "./scene-link";
import { createEntity, createEvidenceSource, createFact, createEntityAlias, updateEntity } from "./story-bible";
import { SceneAnalysisStaleError, SceneEntityLinkConflictError, StoryBibleIdempotencyConflictError, StoryBibleNotFoundError } from "./story-bible-errors";
import { normalizeAnalysisText } from "@/domain/analysis";

const handles: Array<{ database: DatabaseSync; directory: string }> = [];

function isolatedDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "story-phase1-"));
  const database = createDatabase(join(directory, "story.db"));
  handles.push({ database, directory });
  return database;
}

function insertProject(database: DatabaseSync) {
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  database.prepare("INSERT INTO projects (id, title, premise, genre, status, created_at, updated_at) VALUES (:id, :title, '', '', 'active', :createdAt, :updatedAt)").run({ id, title: "Phase 1", createdAt: timestamp, updatedAt: timestamp });
  return id;
}

afterEach(() => {
  while (handles.length > 0) {
    const handle = handles.pop();
    if (!handle) continue;
    handle.database.close();
    rmSync(handle.directory, { recursive: true, force: true });
  }
});

describe("Phase 1 deterministic resolver", () => {
  it("normalizes Chinese, English, and full-width surfaces", () => {
    expect(normalizeAnalysisText("  林　默 ")).toBe("林 默");
    expect(normalizeAnalysisText("Ａｌｉｃｅ  SMITH")).toBe("alice smith");
  });

  it("confirms a unique canonical/alias match and leaves same-name matches ambiguous", () => {
    const database = isolatedDatabase();
    const projectId = insertProject(database);
    const unique = createEntity(projectId, { type: "character", canonicalName: "林默" }, database);
    const alias = createEntityAlias(unique.id, { alias: "Lin Mo" }, projectId, database);
    expect(alias).not.toBeNull();
    if (!alias) throw new Error("Expected the active entity alias to be created");
    const one = analyzeSceneText({ sceneRevisionId: randomUUID(), content: "LIN MO returned.", entities: [unique], aliases: [alias] });
    expect(one[0]?.status).toBe("confirmed");
    const other = createEntity(projectId, { type: "character", canonicalName: "林默" }, database);
    const ambiguous = analyzeSceneText({ sceneRevisionId: randomUUID(), content: "林默 returned.", entities: [unique, other], aliases: [] });
    expect(ambiguous.filter((item) => item.status === "candidate")).toHaveLength(2);
    expect(ambiguous.some((item) => item.status === "confirmed")).toBe(false);
  });

  it("treats same normalized names across types as ambiguous and keeps the longest overlap", () => {
    const database = isolatedDatabase();
    const projectId = insertProject(database);
    const character = createEntity(projectId, { type: "character", canonicalName: "林默" }, database);
    const location = createEntity(projectId, { type: "location", canonicalName: "林默" }, database);
    const short = createEntity(projectId, { type: "character", canonicalName: "林" }, database);
    const crossType = analyzeSceneText({ sceneRevisionId: randomUUID(), content: "林默", entities: [character, location], aliases: [] });
    expect(crossType).toHaveLength(2);
    expect(crossType.every((mention) => mention.status === "candidate")).toBe(true);
    const longest = analyzeSceneText({ sceneRevisionId: randomUUID(), content: "林默", entities: [character, short], aliases: [] });
    expect(longest).toHaveLength(1);
    expect(longest[0]?.surface).toBe("林默");
  });

  it("recognizes explicit stubs as candidates without requiring a model", () => {
    const mention = analyzeSceneText({ sceneRevisionId: randomUUID(), content: "[[character:林默]] enters [[location:酒吧]].", entities: [], aliases: [] });
    expect(mention.map((item) => [item.entityType, item.explicitStub, item.status])).toEqual([["character", true, "candidate"], ["location", true, "candidate"]]);
  });
});

describe("Phase 1 durable analysis and links", () => {
  it("enqueues and executes without waiting on document save, then returns idempotently", () => {
    const database = isolatedDatabase();
    const projectId = insertProject(database);
    const entity = createEntity(projectId, { type: "character", canonicalName: "林默" }, database);
    const document = createDocument(projectId, { title: "Script", requestId: "doc", scenes: [{ title: "One", content: "林默 enters." }] }, database);
    const revision = getDocumentRevision(document.currentRevisionId as string, projectId, database);
    const sceneRevision = revision?.sceneRevisions[0];
    if (!sceneRevision) throw new Error("scene revision missing");
    const queued = enqueueAnalysisRun(projectId, { documentId: document.id, sceneId: sceneRevision.sceneId, sceneRevisionId: sceneRevision.id, requestId: "analysis-1" }, database);
    expect(queued.idempotent).toBe(false);
    expect(queued.run.status).toBe("queued");
    const repeated = enqueueAnalysisRun(projectId, { documentId: document.id, sceneId: sceneRevision.sceneId, sceneRevisionId: sceneRevision.id, requestId: "analysis-1" }, database);
    expect(repeated.idempotent).toBe(true);
    const done = executeAnalysisRun(projectId, queued.run.id, {}, database);
    expect(done.status).toBe("succeeded");
    expect(listSceneEntityLinks(projectId, sceneRevision.sceneId, { sceneRevisionId: sceneRevision.id }, database).find((link) => link.entityId === entity.id)?.status).toBe("confirmed");
    expect(listEntityMentions(projectId, { sceneRevisionId: sceneRevision.id }, database)).toHaveLength(1);
  });

  it("binds semantic duplicate request keys to an input fingerprint", () => {
    const database = isolatedDatabase();
    const projectId = insertProject(database);
    const document = createDocument(projectId, { title: "Script", requestId: "doc", scenes: [{ title: "One", content: "Nothing." }] }, database);
    const scene = getDocumentRevision(document.currentRevisionId as string, projectId, database)?.sceneRevisions[0];
    if (!scene) throw new Error("scene revision missing");
    const first = enqueueAnalysisRun(projectId, { documentId: document.id, sceneId: scene.sceneId, sceneRevisionId: scene.id, requestId: "analysis-first" }, database);
    const semantic = enqueueAnalysisRun(projectId, { documentId: document.id, sceneId: scene.sceneId, sceneRevisionId: scene.id, requestId: "analysis-second" }, database);
    expect(semantic.idempotent).toBe(true);
    expect(semantic.run.id).toBe(first.run.id);
    const mapping = database.prepare("SELECT response_json FROM idempotency_keys WHERE project_id = :projectId AND operation = 'analysis.enqueue' AND request_id = 'analysis-second'").get({ projectId }) as { response_json: string };
    expect(JSON.parse(mapping.response_json)).toMatchObject({ runId: first.run.id, inputFingerprint: { sceneRevisionId: scene.id, analyzerVersion: "deterministic-v1", contentHash: scene.contentHash } });
    expect(() => enqueueAnalysisRun(projectId, { documentId: document.id, sceneId: scene.sceneId, sceneRevisionId: scene.id, analyzerVersion: "deterministic-v2", requestId: "analysis-second" }, database)).toThrow(StoryBibleIdempotencyConflictError);
  });

  it("does not mutate historical or deleted projections when enqueue is rejected", () => {
    const database = isolatedDatabase();
    const projectId = insertProject(database);
    const entity = createEntity(projectId, { type: "character", canonicalName: "Alice" }, database);
    const document = createDocument(projectId, { title: "Script", requestId: "doc", scenes: [{ title: "One", content: "Alice enters." }] }, database);
    const oldScene = getDocumentRevision(document.currentRevisionId as string, projectId, database)?.sceneRevisions[0];
    if (!oldScene) throw new Error("scene revision missing");
    const oldRun = enqueueAnalysisRun(projectId, { documentId: document.id, sceneId: oldScene.sceneId, sceneRevisionId: oldScene.id, requestId: "old-run" }, database);
    expect(executeAnalysisRun(projectId, oldRun.run.id, {}, database).status).toBe("succeeded");
    const replacement = createDocumentRevision(document.id, { baseVersion: document.version, requestId: "replacement", scenes: [{ id: oldScene.sceneId, title: "One", content: "No name." }] }, database);
    expect(() => enqueueAnalysisRun(projectId, { documentId: document.id, sceneId: oldScene.sceneId, sceneRevisionId: oldScene.id, requestId: "historical-enqueue" }, database)).toThrow(SceneAnalysisStaleError);
    expect(listSceneEntityLinks(projectId, oldScene.sceneId, { sceneRevisionId: oldScene.id }, database)[0]?.status).toBe("confirmed");
    expect(getSceneRevision(replacement.sceneRevisions[0].id, projectId, database)?.status).toBe("active");

    const deletedDocument = createDocument(projectId, { title: "Deleted", requestId: "deleted-doc", scenes: [{ title: "Deleted scene", content: "retained", status: "deleted" }] }, database);
    const deletedScene = getDocumentRevision(deletedDocument.currentRevisionId as string, projectId, database)?.sceneRevisions[0];
    if (!deletedScene) throw new Error("deleted scene revision missing");
    expect(() => enqueueAnalysisRun(projectId, { documentId: deletedDocument.id, sceneId: deletedScene.sceneId, sceneRevisionId: deletedScene.id, requestId: "deleted-enqueue" }, database)).toThrow();
    expect((database.prepare("SELECT COUNT(*) AS count FROM analysis_runs WHERE project_id = :projectId AND document_id = :documentId").get({ projectId, documentId: deletedDocument.id }) as { count: number }).count).toBe(0);
    expect(entity.id).toBeTruthy();
  });

  it("retires a succeeded historical run when the current revision is enqueued", () => {
    const database = isolatedDatabase();
    const projectId = insertProject(database);
    createEntity(projectId, { type: "character", canonicalName: "Alice" }, database);
    const document = createDocument(projectId, { title: "History", requestId: "history-doc", scenes: [{ title: "One", content: "Alice." }] }, database);
    const oldScene = getDocumentRevision(document.currentRevisionId as string, projectId, database)?.sceneRevisions[0];
    if (!oldScene) throw new Error("old scene missing");
    const oldRun = enqueueAnalysisRun(projectId, { documentId: document.id, sceneId: oldScene.sceneId, sceneRevisionId: oldScene.id, requestId: "history-v1" }, database);
    expect(executeAnalysisRun(projectId, oldRun.run.id, {}, database).status).toBe("succeeded");
    const next = createDocumentRevision(document.id, { baseVersion: document.version, requestId: "history-v2-doc", scenes: [{ id: oldScene.sceneId, title: "One", content: "No name." }] }, database);
    const currentScene = next.sceneRevisions[0];
    const currentRun = enqueueAnalysisRun(projectId, { documentId: document.id, sceneId: currentScene.sceneId, sceneRevisionId: currentScene.id, requestId: "history-v2" }, database);
    expect(currentRun.idempotent).toBe(false);
    expect((database.prepare("SELECT status FROM analysis_runs WHERE id = :runId").get({ runId: oldRun.run.id }) as { status: string }).status).toBe("stale");
  });

  it("fences a reclaimed lease so an old worker cannot project", () => {
    const database = isolatedDatabase();
    const projectId = insertProject(database);
    const document = createDocument(projectId, { title: "Script", requestId: "doc", scenes: [{ title: "One", content: "No mention." }] }, database);
    const scene = getDocumentRevision(document.currentRevisionId as string, projectId, database)?.sceneRevisions[0];
    if (!scene) throw new Error("scene revision missing");
    const queued = enqueueAnalysisRun(projectId, { documentId: document.id, sceneId: scene.sceneId, sceneRevisionId: scene.id, requestId: "lease-run" }, database);
    const expiry = new Date(Date.now() + 30_000).toISOString();
    database.prepare("UPDATE analysis_runs SET status = 'running', lease_token = 'old-worker', lease_expires_at = :leaseExpiresAt, attempt = 1 WHERE id = :runId AND project_id = :projectId").run({ runId: queued.run.id, projectId, leaseExpiresAt: expiry });
    database.prepare("UPDATE analysis_runs SET lease_token = 'new-worker', lease_expires_at = :leaseExpiresAt WHERE id = :runId AND project_id = :projectId").run({ runId: queued.run.id, projectId, leaseExpiresAt: expiry });
    expect(() => projectAnalysisCandidates({ projectId, documentId: document.id, sceneId: scene.sceneId, sceneRevisionId: scene.id, analysisRunId: queued.run.id, leaseToken: "old-worker", candidates: [] }, database)).toThrow(SceneAnalysisStaleError);
    expect((database.prepare("SELECT status, lease_token FROM analysis_runs WHERE id = :runId").get({ runId: queued.run.id }) as { status: string; lease_token: string }).status).toBe("running");
    expect((database.prepare("SELECT status, lease_token FROM analysis_runs WHERE id = :runId").get({ runId: queued.run.id }) as { status: string; lease_token: string }).lease_token).toBe("new-worker");
  });

  it("creates a draft entity for explicit stub notation and stale runs cannot project", () => {
    const database = isolatedDatabase();
    const projectId = insertProject(database);
    const document = createDocument(projectId, { title: "Script", requestId: "doc", scenes: [{ title: "One", content: "[[prop:银色耳钉]]" }] }, database);
    const firstRevision = getDocumentRevision(document.currentRevisionId as string, projectId, database);
    const firstScene = firstRevision?.sceneRevisions[0];
    if (!firstScene) throw new Error("scene revision missing");
    const queued = enqueueAnalysisRun(projectId, { documentId: document.id, sceneId: firstScene.sceneId, sceneRevisionId: firstScene.id, requestId: "analysis-old" }, database);
    const newRevision = createDocumentRevision(document.id, { baseVersion: document.version, requestId: "revision-new", scenes: [{ id: firstScene.sceneId, title: "One", content: "No prop." }] }, database);
    const stale = executeAnalysisRun(projectId, queued.run.id, {}, database);
    expect(stale.status).toBe("stale");
    expect(listSceneEntityLinks(projectId, firstScene.sceneId, {}, database)).toHaveLength(0);
    const currentScene = getSceneRevision(newRevision.sceneRevisions[0].id, projectId, database);
    if (!currentScene) throw new Error("current revision missing");
    const fresh = enqueueAnalysisRun(projectId, { documentId: document.id, sceneId: currentScene.sceneId, sceneRevisionId: currentScene.id, requestId: "analysis-new" }, database);
    expect(executeAnalysisRun(projectId, fresh.run.id, {}, database).status).toBe("succeeded");
    expect((database.prepare("SELECT COUNT(*) AS count FROM entities WHERE project_id = :projectId AND entity_type = 'prop' AND status = 'draft'").get({ projectId }) as { count: number }).count).toBe(0);
    const stubDocument = createDocument(projectId, { title: "Stub", requestId: "stub-doc", scenes: [{ title: "Stub scene", content: "[[prop:银色耳钉]]" }] }, database);
    const stubScene = getDocumentRevision(stubDocument.currentRevisionId as string, projectId, database)?.sceneRevisions[0];
    if (!stubScene) throw new Error("stub scene missing");
    const stubRun = enqueueAnalysisRun(projectId, { documentId: stubDocument.id, sceneId: stubScene.sceneId, sceneRevisionId: stubScene.id, requestId: "stub-analysis" }, database);
    expect(executeAnalysisRun(projectId, stubRun.run.id, {}, database).status).toBe("succeeded");
    expect((database.prepare("SELECT COUNT(*) AS count FROM entities WHERE project_id = :projectId AND entity_type = 'prop' AND status = 'draft'").get({ projectId }) as { count: number }).count).toBe(1);
    expect(listSceneEntityLinks(projectId, stubScene.sceneId, { sceneRevisionId: stubScene.id }, database)[0]?.status).toBe("candidate");
  });

  it("rejects an ambiguous candidate with CAS and suppresses it on repeat analysis", () => {
    const database = isolatedDatabase();
    const projectId = insertProject(database);
    createEntity(projectId, { type: "character", canonicalName: "林默" }, database);
    createEntity(projectId, { type: "character", canonicalName: "林默" }, database);
    const document = createDocument(projectId, { title: "Script", requestId: "doc", scenes: [{ title: "One", content: "林默 arrives." }] }, database);
    const scene = getDocumentRevision(document.currentRevisionId as string, projectId, database)?.sceneRevisions[0];
    if (!scene) throw new Error("scene revision missing");
    const first = enqueueAnalysisRun(projectId, { documentId: document.id, sceneId: scene.sceneId, sceneRevisionId: scene.id, requestId: "analysis-ambiguous" }, database);
    executeAnalysisRun(projectId, first.run.id, {}, database);
    const candidates = listSceneEntityLinks(projectId, scene.sceneId, { sceneRevisionId: scene.id, status: "candidate" }, database);
    expect(candidates).toHaveLength(2);
    expect(() => reviewSceneEntityLink(candidates[0].id, { status: "rejected", expectedVersion: candidates[0].version, expectedSceneRevisionId: scene.id, requestId: "reject" }, projectId, database)).not.toThrow();
    expect(() => reviewSceneEntityLink(candidates[0].id, { status: "rejected", expectedVersion: candidates[0].version, expectedSceneRevisionId: scene.id, requestId: "stale" }, projectId, database)).toThrow(SceneEntityLinkConflictError);
    const alreadyRejected = listSceneEntityLinks(projectId, scene.sceneId, { sceneRevisionId: scene.id }, database).find((link) => link.id === candidates[0].id);
    if (!alreadyRejected) throw new Error("reviewed candidate missing");
    expect(() => reviewSceneEntityLink(alreadyRejected.id, { status: "rejected", expectedVersion: alreadyRejected.version, expectedSceneRevisionId: scene.id, requestId: "reject-again" }, projectId, database)).toThrow(SceneEntityLinkConflictError);
    const second = enqueueAnalysisRun(projectId, { documentId: document.id, sceneId: scene.sceneId, sceneRevisionId: scene.id, requestId: "analysis-repeat" }, database);
    executeAnalysisRun(projectId, second.run.id, {}, database);
    const rejected = listSceneEntityLinks(projectId, scene.sceneId, { sceneRevisionId: scene.id, status: "rejected" }, database);
    expect(rejected).toHaveLength(1);
    const rejectedMention = listEntityMentions(projectId, { sceneRevisionId: scene.id }, database).find((mention) => mention.entityId === candidates[0].entityId);
    if (!rejectedMention) throw new Error("rejected mention missing");
    expect(() => database.prepare("UPDATE entity_mentions SET status = 'active' WHERE id = :id").run({ id: rejectedMention.id })).toThrow();
  });

  it("rechecks entity resolvability before confirming a candidate", () => {
    const database = isolatedDatabase();
    const projectId = insertProject(database);
    const archivedLater = createEntity(projectId, { type: "character", canonicalName: "林默" }, database);
    createEntity(projectId, { type: "character", canonicalName: "林默" }, database);
    const document = createDocument(projectId, { title: "Review", requestId: "review-doc", scenes: [{ title: "One", content: "林默 arrives." }] }, database);
    const scene = getDocumentRevision(document.currentRevisionId as string, projectId, database)?.sceneRevisions[0];
    if (!scene) throw new Error("scene revision missing");
    const run = enqueueAnalysisRun(projectId, { documentId: document.id, sceneId: scene.sceneId, sceneRevisionId: scene.id, requestId: "review-run" }, database);
    executeAnalysisRun(projectId, run.run.id, {}, database);
    const candidate = listSceneEntityLinks(projectId, scene.sceneId, { sceneRevisionId: scene.id, status: "candidate" }, database).find((link) => link.entityId === archivedLater.id);
    if (!candidate) throw new Error("candidate missing");
    updateEntity(archivedLater.id, { status: "archived", baseVersion: 1, requestId: "archive-before-review" }, database);
    expect(() => reviewSceneEntityLink(candidate.id, { status: "confirmed", expectedVersion: candidate.version, expectedSceneRevisionId: scene.id, requestId: "confirm-archived" }, projectId, database)).toThrow(SceneEntityLinkConflictError);
    expect(listSceneEntityLinks(projectId, scene.sceneId, { sceneRevisionId: scene.id }, database).find((link) => link.id === candidate.id)?.status).toBe("candidate");
  });

  it("preserves confirmed and rejected decisions when the analyzer version changes", () => {
    const database = isolatedDatabase();
    const projectId = insertProject(database);
    const confirmedEntity = createEntity(projectId, { type: "character", canonicalName: "Alice" }, database);
    const firstDocument = createDocument(projectId, { title: "Confirmed", requestId: "confirmed-doc", scenes: [{ title: "One", content: "Alice enters." }] }, database);
    const firstScene = getDocumentRevision(firstDocument.currentRevisionId as string, projectId, database)?.sceneRevisions[0];
    if (!firstScene) throw new Error("confirmed scene missing");
    const firstRun = enqueueAnalysisRun(projectId, { documentId: firstDocument.id, sceneId: firstScene.sceneId, sceneRevisionId: firstScene.id, requestId: "confirmed-v1" }, database);
    expect(executeAnalysisRun(projectId, firstRun.run.id, {}, database).status).toBe("succeeded");
    const confirmedV2 = enqueueAnalysisRun(projectId, { documentId: firstDocument.id, sceneId: firstScene.sceneId, sceneRevisionId: firstScene.id, analyzerVersion: "deterministic-v2", requestId: "confirmed-v2" }, database);
    expect(executeAnalysisRun(projectId, confirmedV2.run.id, {}, database).status).toBe("succeeded");
    expect(listSceneEntityLinks(projectId, firstScene.sceneId, { sceneRevisionId: firstScene.id }, database).find((link) => link.entityId === confirmedEntity.id)?.status).toBe("confirmed");
    expect(listEntityMentions(projectId, { sceneRevisionId: firstScene.id }, database).filter((mention) => mention.status === "stale")).toHaveLength(1);

    const rejectedA = createEntity(projectId, { type: "character", canonicalName: "林默" }, database);
    createEntity(projectId, { type: "character", canonicalName: "林默" }, database);
    const rejectedDocument = createDocument(projectId, { title: "Rejected", requestId: "rejected-doc", scenes: [{ title: "One", content: "林默 arrives." }] }, database);
    const rejectedScene = getDocumentRevision(rejectedDocument.currentRevisionId as string, projectId, database)?.sceneRevisions[0];
    if (!rejectedScene) throw new Error("rejected scene missing");
    const rejectedRun = enqueueAnalysisRun(projectId, { documentId: rejectedDocument.id, sceneId: rejectedScene.sceneId, sceneRevisionId: rejectedScene.id, requestId: "rejected-v1" }, database);
    executeAnalysisRun(projectId, rejectedRun.run.id, {}, database);
    const candidates = listSceneEntityLinks(projectId, rejectedScene.sceneId, { sceneRevisionId: rejectedScene.id, status: "candidate" }, database);
    expect(candidates).toHaveLength(2);
    const rejectedLink = candidates.find((link) => link.entityId === rejectedA.id);
    if (!rejectedLink) throw new Error("rejected candidate missing");
    reviewSceneEntityLink(rejectedLink.id, { status: "rejected", expectedVersion: rejectedLink.version, expectedSceneRevisionId: rejectedScene.id, requestId: "reject-v1" }, projectId, database);
    const rejectedV2 = enqueueAnalysisRun(projectId, { documentId: rejectedDocument.id, sceneId: rejectedScene.sceneId, sceneRevisionId: rejectedScene.id, analyzerVersion: "deterministic-v2", requestId: "rejected-v2" }, database);
    expect(executeAnalysisRun(projectId, rejectedV2.run.id, {}, database).status).toBe("succeeded");
    expect(listSceneEntityLinks(projectId, rejectedScene.sceneId, { sceneRevisionId: rejectedScene.id, status: "rejected" }, database).some((link) => link.entityId === rejectedA.id)).toBe(true);
    expect(listSceneEntityLinks(projectId, rejectedScene.sceneId, { sceneRevisionId: rejectedScene.id, status: "candidate" }, database)).toHaveLength(1);
  });

  it("aggregates repeated mentions into one link without a spurious CAS transition", () => {
    const database = isolatedDatabase();
    const projectId = insertProject(database);
    const document = createDocument(projectId, { title: "Repeated", requestId: "repeated-doc", scenes: [{ title: "One", content: "[[prop:银色耳钉]] appears; [[prop:银色耳钉]] glints." }] }, database);
    const scene = getDocumentRevision(document.currentRevisionId as string, projectId, database)?.sceneRevisions[0];
    if (!scene) throw new Error("scene revision missing");
    const run = enqueueAnalysisRun(projectId, { documentId: document.id, sceneId: scene.sceneId, sceneRevisionId: scene.id, requestId: "repeated-run" }, database);
    expect(executeAnalysisRun(projectId, run.run.id, {}, database).status).toBe("succeeded");
    expect(listEntityMentions(projectId, { sceneRevisionId: scene.id }, database)).toHaveLength(2);
    const links = listSceneEntityLinks(projectId, scene.sceneId, { sceneRevisionId: scene.id }, database);
    expect(links).toHaveLength(1);
    expect(links[0].mentionIds).toHaveLength(2);
  });

  it("keeps links project scoped and protects immutable facts", () => {
    const database = isolatedDatabase();
    const projectA = insertProject(database);
    const projectB = insertProject(database);
    const entity = createEntity(projectA, { type: "character", canonicalName: "A" }, database);
    const source = createEvidenceSource(projectA, { kind: "user_input" }, database);
    const fact = createFact(projectA, { subjectEntityId: entity.id, predicate: "appearance.hair", value: "black", valueType: "string", scope: "base", sourceId: source.id }, database);
    expect(() => createEntityAlias(entity.id, { alias: "A" }, projectB, database)).toThrow(StoryBibleNotFoundError);
    expect(() => database.prepare("UPDATE facts SET value_json = :value WHERE id = :id").run({ id: fact.id, value: JSON.stringify("silver") })).toThrow();
    expect((database.prepare("SELECT version FROM facts WHERE id = :id").get({ id: fact.id }) as { version: number }).version).toBe(1);
  });
});
