import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDatabase } from "./connection";
import { bootstrapDatabase, CURRENT_SCHEMA_VERSION } from "./schema";
import { createDocument, createDocumentRevision, getDocument, getDocumentRevision, listScenes } from "./document";
import { createEntity, createEntityAlias, createEvidenceSource, createFact, createStoryBibleRepository, supersedeFact, updateEntity } from "./story-bible";
import { StoryBibleConflictError, StoryBibleNotFoundError, StoryBibleValidationError } from "./story-bible-errors";

const handles: Array<{ database: DatabaseSync; directory: string }> = [];

function isolatedDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "story-phase0-"));
  const database = createDatabase(join(directory, "story.db"));
  handles.push({ database, directory });
  return database;
}

function insertProject(database: DatabaseSync) {
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  database.prepare("INSERT INTO projects (id, title, premise, genre, status, created_at, updated_at) VALUES (:id, :title, '', '', 'active', :createdAt, :updatedAt)").run({ id, title: "Phase 0", createdAt: timestamp, updatedAt: timestamp });
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

describe("Phase 0 document aggregate", () => {
  it("adds the Phase 0 tables when bootstrapping an existing v4 file", () => {
    const database = isolatedDatabase();
    const projectId = insertProject(database);
    database.exec("PRAGMA foreign_keys = OFF; DROP TABLE idempotency_keys; DROP TABLE outbox_events; DROP TABLE audit_events; DROP TABLE facts; DROP TABLE evidence_sources; DROP TABLE entity_aliases; DROP TABLE entities; DROP TABLE scene_revisions; DROP TABLE scenes; DROP TABLE document_revisions; DROP TABLE script_documents; PRAGMA user_version = 4; PRAGMA foreign_keys = ON;");
    bootstrapDatabase(database);
    expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(CURRENT_SCHEMA_VERSION);
    expect((database.prepare("SELECT title FROM projects WHERE id = :projectId").get({ projectId }) as { title: string }).title).toBe("Phase 0");
    expect((database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scene_revisions'").get() as { name: string }).name).toBe("scene_revisions");
  });

  it("preserves scene IDs across reorder and statefully marks omitted scenes deleted", () => {
    const database = isolatedDatabase();
    const projectId = insertProject(database);
    const document = createDocument(projectId, { title: "Draft", requestId: "create-document", scenes: [{ title: "A", content: "one" }, { title: "B", content: "two" }] }, database);
    const first = listScenes(document.id, projectId, database);
    const revised = createDocumentRevision(document.id, { baseVersion: document.version, requestId: "reorder", scenes: [{ id: first[1].id, title: "B", content: "two" }, { id: first[0].id, title: "A", content: "one" }] }, database);
    expect(revised.sceneRevisions.map((scene) => scene.sceneId)).toEqual([first[1].id, first[0].id]);
    expect(listScenes(document.id, projectId, database).map((scene) => [scene.id, scene.narrativeRank])).toEqual([[first[1].id, 0], [first[0].id, 1]]);

    const deleted = createDocumentRevision(document.id, { baseVersion: document.version + 1, requestId: "delete-a", scenes: [{ id: first[1].id, title: "B", content: "two" }] }, database);
    expect(deleted.sceneRevisions.find((scene) => scene.sceneId === first[0].id)?.status).toBe("deleted");
    expect(listScenes(document.id, projectId, database).find((scene) => scene.id === first[0].id)?.status).toBe("deleted");
  });

  it("rejects stale document revisions without changing the current version", () => {
    const database = isolatedDatabase();
    const projectId = insertProject(database);
    const document = createDocument(projectId, { title: "Draft", requestId: "create-document" }, database);
    createDocumentRevision(document.id, { baseVersion: document.version, requestId: "first-revision", scenes: [{ title: "A", content: "one" }] }, database);
    expect(() => createDocumentRevision(document.id, { baseVersion: document.version, requestId: "stale-revision", scenes: [] }, database)).toThrow(StoryBibleConflictError);
    expect(getDocument(document.id, database)?.version).toBe(document.version + 1);
  });

  it("upgrades legacy files to the current schema and protects revision/evidence provenance", () => {
    const database = isolatedDatabase();
    const projectId = insertProject(database);
    database.exec("DROP TRIGGER IF EXISTS document_revisions_immutable_columns_guard; DROP TRIGGER IF EXISTS scene_revisions_immutable_columns_guard; DROP TRIGGER IF EXISTS evidence_sources_update_revision_project_guard; DROP TRIGGER IF EXISTS evidence_sources_immutable_columns_guard; DROP TRIGGER IF EXISTS entities_confirmed_link_guard; DROP TRIGGER IF EXISTS scene_entity_links_confirmed_entity_guard; DROP TRIGGER IF EXISTS scene_entity_links_confirmed_entity_update_guard; PRAGMA user_version = 6;");
    bootstrapDatabase(database);
    expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(CURRENT_SCHEMA_VERSION);
    const document = createDocument(projectId, { title: "Immutable", requestId: "immutable-document", scenes: [{ title: "One", content: "Anchor" }] }, database);
    const scene = getDocumentRevision(document.currentRevisionId as string, projectId, database)?.sceneRevisions[0];
    if (!scene) throw new Error("scene revision missing");
    const source = createEvidenceSource(projectId, { kind: "text_span", documentId: document.id, sceneId: scene.sceneId, sceneRevisionId: scene.id, revisionId: scene.id, quotedText: "Anchor", requestId: "immutable-source" }, database);
    expect(() => database.prepare("UPDATE document_revisions SET content_hash = :hash WHERE id = :id").run({ id: document.currentRevisionId, hash: "bad" })).toThrow();
    expect(() => database.prepare("UPDATE scene_revisions SET content = :content WHERE id = :id").run({ id: scene.id, content: "mutated" })).toThrow();
    expect(() => database.prepare("UPDATE evidence_sources SET revision_id = NULL WHERE id = :id").run({ id: source.id })).toThrow();
  });

  it("retains tombstone guards for confirmed and candidate links", () => {
    const database = isolatedDatabase();
    const projectId = insertProject(database);
    database.exec("DROP TRIGGER IF EXISTS entities_confirmed_link_guard; DROP TRIGGER IF EXISTS scene_entity_links_confirmed_entity_guard; DROP TRIGGER IF EXISTS scene_entity_links_confirmed_entity_update_guard; PRAGMA user_version = 7;");
    bootstrapDatabase(database);
    const entity = createEntity(projectId, { type: "character", canonicalName: "Alice" }, database);
    const document = createDocument(projectId, { title: "Links", requestId: "links-document", scenes: [{ title: "One", content: "Alice" }] }, database);
    const scene = getDocumentRevision(document.currentRevisionId as string, projectId, database)?.sceneRevisions[0];
    if (!scene) throw new Error("scene revision missing");
    const timestamp = new Date().toISOString();
    const confirmedLinkId = randomUUID();
    database.prepare("INSERT INTO scene_entity_links (id, project_id, scene_id, scene_revision_id, entity_id, entity_type, role, status, resolver, confidence, version, candidate_group_id, fingerprint, analysis_run_id, created_at, updated_at) VALUES (:id, :projectId, :sceneId, :sceneRevisionId, :entityId, 'character', 'appears', 'confirmed', 'user', 1, 1, :candidateGroupId, :fingerprint, NULL, :createdAt, :updatedAt)").run({ id: confirmedLinkId, projectId, sceneId: scene.sceneId, sceneRevisionId: scene.id, entityId: entity.id, candidateGroupId: randomUUID(), fingerprint: `confirmed:${confirmedLinkId}`, createdAt: timestamp, updatedAt: timestamp });
    expect(() => database.prepare("UPDATE entities SET status = 'archived' WHERE id = :id").run({ id: entity.id })).toThrow();
    expect(() => updateEntity(entity.id, { status: "archived", baseVersion: entity.version, requestId: "archive-linked" }, database)).toThrow(StoryBibleConflictError);

    const archived = createEntity(projectId, { type: "character", canonicalName: "Archived", status: "archived" }, database);
    const candidateLinkId = randomUUID();
    database.prepare("INSERT INTO scene_entity_links (id, project_id, scene_id, scene_revision_id, entity_id, entity_type, role, status, resolver, confidence, version, candidate_group_id, fingerprint, analysis_run_id, created_at, updated_at) VALUES (:id, :projectId, :sceneId, :sceneRevisionId, :entityId, 'character', 'appears', 'candidate', 'user', NULL, 1, :candidateGroupId, :fingerprint, NULL, :createdAt, :updatedAt)").run({ id: candidateLinkId, projectId, sceneId: scene.sceneId, sceneRevisionId: scene.id, entityId: archived.id, candidateGroupId: randomUUID(), fingerprint: `candidate:${candidateLinkId}`, createdAt: timestamp, updatedAt: timestamp });
    expect(() => database.prepare("UPDATE scene_entity_links SET status = 'confirmed', version = version + 1 WHERE id = :id").run({ id: candidateLinkId })).toThrow();
  });
});

describe("Phase 0 Story Bible", () => {
  it("validates predicates and creates an immutable fact supersede chain", () => {
    const database = isolatedDatabase();
    const projectId = insertProject(database);
    const entity = createEntity(projectId, { type: "character", canonicalName: "Lin Mo", requestId: "entity" }, database);
    const source = createEvidenceSource(projectId, { kind: "user_input", requestId: "source" }, database);
    const first = createFact(projectId, { subjectEntityId: entity.id, predicate: "appearance.hair", value: "black", valueType: "string", scope: "base", sourceId: source.id, requestId: "fact-1" }, database);
    const second = supersedeFact(first.id, { value: "silver", valueType: "string", sourceId: source.id, expectedVersion: first.version, requestId: "fact-2" }, database);
    expect(second).toBeTruthy();
    expect(second?.supersedesFactId).toBe(first.id);
    expect(createStoryBibleRepository(database).getFact(first.id)).toMatchObject({ status: "superseded", version: first.version + 1 });
    expect(() => createFact(projectId, { subjectEntityId: entity.id, predicate: "not.allowed", value: "x", valueType: "string", scope: "base", sourceId: source.id, requestId: "bad" }, database)).toThrow(StoryBibleValidationError);
  });

  it("enforces project scoping and request idempotency", () => {
    const database = isolatedDatabase();
    const projectA = insertProject(database);
    const projectB = insertProject(database);
    const entityA = createEntity(projectA, { type: "character", canonicalName: "A", requestId: "same" }, database);
    expect(createEntity(projectA, { type: "character", canonicalName: "Different", requestId: "same" }, database).id).toBe(entityA.id);
    expect(() => createEntityAlias(entityA.id, { alias: "A", requestId: "foreign" }, projectB, database)).toThrow(StoryBibleNotFoundError);

    const directAliasId = randomUUID();
    expect(() => database.prepare("INSERT INTO entity_aliases (id, project_id, entity_id, alias, normalized_alias, locale, status, created_at) VALUES (:id, :projectId, :entityId, 'bad', 'bad', NULL, 'active', :createdAt)").run({ id: directAliasId, projectId: projectB, entityId: entityA.id, createdAt: new Date().toISOString() })).toThrow();
  });
});
