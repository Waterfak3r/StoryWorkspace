import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase } from "./connection";
import { bootstrapDatabase, CURRENT_SCHEMA_VERSION } from "./schema";
import { createDocument, createDocumentRevision, getDocumentRevision } from "./document";
import { createEntity, createEvidenceSource, createFact } from "./story-bible";
import { buildContextSnapshot, getContextSnapshot, listContextSnapshots } from "./context-builder";
import { SceneAnalysisStaleError, StoryBibleIdempotencyConflictError } from "./story-bible-errors";

type Handle = { database: DatabaseSync; directory: string };
const handles: Handle[] = [];

function isolatedDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "story-phase4-"));
  const database = createDatabase(join(directory, "story.db"));
  handles.push({ database, directory });
  return database;
}

function project(database: DatabaseSync, title = "Phase 4") {
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  database.prepare("INSERT INTO projects (id, title, premise, genre, status, created_at, updated_at) VALUES (:id, :title, '', '', 'active', :createdAt, :updatedAt)").run({ id, title, createdAt: timestamp, updatedAt: timestamp });
  return id;
}

function confirmLink(database: DatabaseSync, projectId: string, sceneId: string, sceneRevisionId: string, entityId: string, entityType: "character" | "location") {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  database.prepare("INSERT INTO scene_entity_links (id, project_id, scene_id, scene_revision_id, entity_id, entity_type, role, status, resolver, confidence, version, candidate_group_id, fingerprint, analysis_run_id, created_at, updated_at) VALUES (:id, :projectId, :sceneId, :sceneRevisionId, :entityId, :entityType, :role, 'confirmed', 'user', 1, 1, :candidateGroupId, :fingerprint, NULL, :createdAt, :updatedAt)").run({ id, projectId, sceneId, sceneRevisionId, entityId, entityType, role: entityType === "character" ? "appears" : "located_at", candidateGroupId: randomUUID(), fingerprint: `phase4:${id}`, createdAt, updatedAt: createdAt });
  return id;
}

function fixture(database: DatabaseSync) {
  const projectId = project(database);
  const character = createEntity(projectId, { type: "character", canonicalName: "Lin" }, database);
  const location = createEntity(projectId, { type: "location", canonicalName: "Bar" }, database);
  const document = createDocument(projectId, { title: "Script", requestId: "phase4-document", scenes: [{ title: "One", content: "Lin enters the bar." }] }, database);
  const revision = getDocumentRevision(document.currentRevisionId as string, projectId, database);
  if (!revision) throw new Error("revision missing");
  const scene = revision.sceneRevisions[0];
  const source = createEvidenceSource(projectId, { kind: "user_input", documentId: document.id, sceneId: scene.sceneId, sceneRevisionId: scene.id, requestId: "phase4-source" }, database);
  createFact(projectId, { subjectEntityId: character.id, predicate: "appearance.hair", value: "black", valueType: "string", scope: "base", sourceId: source.id, requestId: "phase4-hair" }, database);
  const characterLink = confirmLink(database, projectId, scene.sceneId, scene.id, character.id, "character");
  const locationLink = confirmLink(database, projectId, scene.sceneId, scene.id, location.id, "location");
  return { projectId, character, location, document, scene, characterLink, locationLink, source };
}

afterEach(() => {
  while (handles.length > 0) {
    const handle = handles.pop();
    if (!handle) continue;
    handle.database.close();
    rmSync(handle.directory, { recursive: true, force: true });
  }
});

describe("Phase 4 context builder", () => {
  it("builds deterministic provenance-bearing snapshots and replays by request and content", () => {
    const database = isolatedDatabase();
    const fixtureValues = fixture(database);
    const input = { sceneId: fixtureValues.scene.sceneId, sceneRevisionId: fixtureValues.scene.id, purpose: "storyboard" as const, policyId: "storyboard-default-v1" as const, allowInferred: false as const, requestId: "build-one" };
    const first = buildContextSnapshot(fixtureValues.projectId, input, database);
    expect(first.idempotent).toBe(false);
    expect(first.snapshot.policyVersion).toBe("1");
    expect(first.snapshot.content.entities.map((entity) => entity.entityId)).toEqual([fixtureValues.character.id, fixtureValues.location.id].sort());
    expect(first.snapshot.content.entities.find((entity) => entity.entityId === fixtureValues.character.id)?.baseFacts[0]).toMatchObject({ sourceId: fixtureValues.source.id, predicate: "appearance.hair" });
    expect(buildContextSnapshot(fixtureValues.projectId, input, database)).toMatchObject({ idempotent: true, snapshot: { id: first.snapshot.id } });
    const semantic = buildContextSnapshot(fixtureValues.projectId, { ...input, requestId: "build-two" }, database);
    expect(semantic).toMatchObject({ idempotent: true, snapshot: { id: first.snapshot.id } });
    const changedSource = createEvidenceSource(fixtureValues.projectId, { kind: "user_input", documentId: fixtureValues.document.id, sceneId: fixtureValues.scene.sceneId, sceneRevisionId: fixtureValues.scene.id, requestId: "phase4-changed-source" }, database);
    createFact(fixtureValues.projectId, { subjectEntityId: fixtureValues.character.id, predicate: "identity.age", value: 30, valueType: "number", scope: "base", sourceId: changedSource.id, requestId: "phase4-changed-fact" }, database);
    expect(buildContextSnapshot(fixtureValues.projectId, input, database)).toMatchObject({ idempotent: true, snapshot: { id: first.snapshot.id } });
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE project_id = :projectId AND event_type = 'context.built'").get({ projectId: fixtureValues.projectId })).toMatchObject({ count: 1 });
  });

  it("excludes candidates, reports missing/conflicts, and fences stale revisions", () => {
    const database = isolatedDatabase();
    const values = fixture(database);
    const candidate = createEntity(values.projectId, { type: "character", canonicalName: "Candidate" }, database);
    const candidateLink = randomUUID();
    const createdAt = new Date().toISOString();
    database.prepare("INSERT INTO scene_entity_links (id, project_id, scene_id, scene_revision_id, entity_id, entity_type, role, status, resolver, confidence, version, candidate_group_id, fingerprint, analysis_run_id, created_at, updated_at) VALUES (:id, :projectId, :sceneId, :sceneRevisionId, :entityId, 'character', 'appears', 'candidate', 'user', 0.5, 1, :candidateGroupId, :fingerprint, NULL, :createdAt, :updatedAt)").run({ id: candidateLink, projectId: values.projectId, sceneId: values.scene.sceneId, sceneRevisionId: values.scene.id, entityId: candidate.id, candidateGroupId: randomUUID(), fingerprint: `candidate:${candidateLink}`, createdAt, updatedAt: createdAt });
    const conflictSource = createEvidenceSource(values.projectId, { kind: "user_input", documentId: values.document.id, sceneId: values.scene.sceneId, sceneRevisionId: values.scene.id, requestId: "phase4-conflict-source" }, database);
    const insertState = database.prepare("INSERT INTO entity_states (id, project_id, entity_id, predicate, value_json, value_type, applies_at_scene_id, source_revision_id, continuity_group_id, carry_forward, priority, valid_to_scene_id, source_id, truth_class, status, version, created_at) VALUES (:id, :projectId, :entityId, 'wardrobe.current', :valueJson, 'string', :sceneId, :sceneRevisionId, :continuityGroupId, 0, 100, NULL, :sourceId, 'canon', 'active', 1, :createdAt)");
    insertState.run({ id: randomUUID(), projectId: values.projectId, entityId: values.character.id, valueJson: JSON.stringify("black coat"), sceneId: values.scene.sceneId, sceneRevisionId: values.scene.id, continuityGroupId: values.scene.continuityGroupId, sourceId: values.source.id, createdAt });
    insertState.run({ id: randomUUID(), projectId: values.projectId, entityId: values.character.id, valueJson: JSON.stringify("grey suit"), sceneId: values.scene.sceneId, sceneRevisionId: values.scene.id, continuityGroupId: values.scene.continuityGroupId, sourceId: conflictSource.id, createdAt });
    const result = buildContextSnapshot(values.projectId, { sceneId: values.scene.sceneId, sceneRevisionId: values.scene.id, purpose: "video", policyId: "video-default-v1", requestId: "candidate-build" }, database);
    expect(result.snapshot.content.entities.some((entity) => entity.entityId === candidate.id)).toBe(false);
    expect(result.snapshot.content.omitted).toContainEqual(expect.objectContaining({ recordId: candidateLink, reason: "not_confirmed" }));
    expect(result.snapshot.content.conflicts).toContainEqual(expect.objectContaining({ code: "state.conflict", entityId: values.character.id, predicate: "wardrobe.current" }));
    expect(result.snapshot.content.provenance).toContainEqual(expect.objectContaining({ kind: "state", version: 1 }));
    expect(result.snapshot.content.hasBlockingIssues).toBe(true);
    const replacement = createDocumentRevision(values.document.id, { baseVersion: values.document.version, requestId: "phase4-replacement", scenes: [{ id: values.scene.sceneId, title: "One", content: "Changed." }] }, database);
    expect(() => buildContextSnapshot(values.projectId, { sceneId: values.scene.sceneId, sceneRevisionId: values.scene.id, purpose: "video", policyId: "video-default-v1", requestId: "stale-build" }, database)).toThrow(SceneAnalysisStaleError);
    expect(replacement.sceneRevisions[0].id).not.toBe(values.scene.id);
    expect(() => database.prepare("INSERT INTO context_snapshots (id, project_id, scene_id, scene_revision_id, purpose, policy_id, policy_version, input_hash, content_json, content_hash, is_latest, created_at) VALUES (:id, :projectId, :sceneId, :sceneRevisionId, 'storyboard', 'storyboard-default-v1', '1', :inputHash, :contentJson, :contentHash, 0, :createdAt)").run({ id: randomUUID(), projectId: values.projectId, sceneId: values.scene.sceneId, sceneRevisionId: values.scene.id, inputHash: "e".repeat(64), contentJson: JSON.stringify(result.snapshot.content), contentHash: "f".repeat(64), createdAt: new Date().toISOString() })).toThrow();
  });

  it("keeps project isolation and immutable content/latest guards", () => {
    const database = isolatedDatabase();
    const values = fixture(database);
    const first = buildContextSnapshot(values.projectId, { sceneId: values.scene.sceneId, sceneRevisionId: values.scene.id, purpose: "storyboard", policyId: "storyboard-default-v1", requestId: "immutability-one" }, database).snapshot;
    const otherProjectId = project(database, "Other");
    expect(getContextSnapshot(first.id, otherProjectId, database)).toBeNull();
    expect(() => database.prepare("UPDATE context_snapshots SET content_json = '{}' WHERE id = :id").run({ id: first.id })).toThrow();
    expect(() => database.prepare("UPDATE context_snapshots SET id = :replacementId WHERE id = :id").run({ id: first.id, replacementId: randomUUID() })).toThrow();
    expect(database.prepare("SELECT policy_version FROM context_snapshots WHERE id = :id").get({ id: first.id })).toMatchObject({ policy_version: "1" });
    const extraSource = createEvidenceSource(values.projectId, { kind: "user_input", documentId: values.document.id, sceneId: values.scene.sceneId, sceneRevisionId: values.scene.id, requestId: "phase4-extra-source" }, database);
    createFact(values.projectId, { subjectEntityId: values.character.id, predicate: "identity.age", value: 30, valueType: "number", scope: "base", sourceId: extraSource.id, requestId: "phase4-age" }, database);
    const second = buildContextSnapshot(values.projectId, { sceneId: values.scene.sceneId, sceneRevisionId: values.scene.id, purpose: "storyboard", policyId: "storyboard-default-v1", requestId: "immutability-two" }, database).snapshot;
    expect(second.id).not.toBe(first.id);
    expect(listContextSnapshots(values.projectId, { latest: true }, database).map((snapshot) => snapshot.id)).toEqual([second.id]);
    expect(getContextSnapshot(first.id, values.projectId, database)?.contentHash).toBe(first.contentHash);
  });

  it("reports deterministic scene, entity subtree, and per-entity Fact budgets", () => {
    const database = isolatedDatabase();
    const values = fixture(database);
    const replacement = createDocumentRevision(values.document.id, { baseVersion: values.document.version, requestId: "phase4-budget-revision", scenes: [{ id: values.scene.sceneId, title: "Long scene", content: "x".repeat(40_001) }] }, database);
    const currentScene = replacement.sceneRevisions[0];
    confirmLink(database, values.projectId, currentScene.sceneId, currentScene.id, values.character.id, "character");
    confirmLink(database, values.projectId, currentScene.sceneId, currentScene.id, values.location.id, "location");
    const longScene = buildContextSnapshot(values.projectId, { sceneId: currentScene.sceneId, sceneRevisionId: currentScene.id, purpose: "storyboard", policyId: "storyboard-default-v1", requestId: "phase4-budget-scene" }, database).snapshot.content;
    expect(longScene.scene.text).toHaveLength(40_000);
    expect(longScene.omitted).toContainEqual({ kind: "scene", reason: "budget" });
    expect(longScene.warnings).toContainEqual(expect.objectContaining({ code: "budget.sceneChars" }));

    const linkedCharacters = [values.character];
    for (let index = 0; index < 20; index += 1) {
      const character = createEntity(values.projectId, { type: "character", canonicalName: `Budget character ${String(index).padStart(2, "0")}` }, database);
      linkedCharacters.push(character);
      confirmLink(database, values.projectId, currentScene.sceneId, currentScene.id, character.id, "character");
    }
    const excludedCharacter = [...linkedCharacters].sort((left, right) => left.id.localeCompare(right.id)).at(-1);
    if (!excludedCharacter) throw new Error("excluded character missing");
    const excludedSource = createEvidenceSource(values.projectId, { kind: "user_input", documentId: values.document.id, sceneId: currentScene.sceneId, sceneRevisionId: currentScene.id, requestId: "phase4-budget-excluded-source" }, database);
    const excludedFact = createFact(values.projectId, { subjectEntityId: excludedCharacter.id, predicate: "appearance.hair", value: "silver", valueType: "string", scope: "base", sourceId: excludedSource.id, requestId: "phase4-budget-excluded-fact" }, database);
    const excludedStateId = randomUUID();
    database.prepare("INSERT INTO entity_states (id, project_id, entity_id, predicate, value_json, value_type, applies_at_scene_id, source_revision_id, continuity_group_id, carry_forward, priority, valid_to_scene_id, source_id, truth_class, status, version, created_at) VALUES (:id, :projectId, :entityId, 'wardrobe.current', :valueJson, 'string', :sceneId, :sceneRevisionId, :continuityGroupId, 0, 100, NULL, :sourceId, 'canon', 'active', 1, :createdAt)").run({ id: excludedStateId, projectId: values.projectId, entityId: excludedCharacter.id, valueJson: JSON.stringify("budget coat"), sceneId: currentScene.sceneId, sceneRevisionId: currentScene.id, continuityGroupId: currentScene.continuityGroupId, sourceId: excludedSource.id, createdAt: new Date().toISOString() });
    const entityBudget = buildContextSnapshot(values.projectId, { sceneId: currentScene.sceneId, sceneRevisionId: currentScene.id, purpose: "video", policyId: "video-default-v1", requestId: "phase4-budget-entities" }, database).snapshot.content;
    expect(entityBudget.entities).toHaveLength(20);
    expect(entityBudget.omitted).toContainEqual(expect.objectContaining({ kind: "entity", recordId: excludedCharacter.id, reason: "budget" }));
    expect(entityBudget.omitted).toContainEqual(expect.objectContaining({ kind: "link", entityId: excludedCharacter.id, reason: "budget" }));
    expect(entityBudget.omitted).toContainEqual(expect.objectContaining({ kind: "fact", recordId: excludedFact.id, reason: "budget" }));
    expect(entityBudget.omitted).toContainEqual(expect.objectContaining({ kind: "state", recordId: excludedStateId, reason: "budget" }));

    const includedCharacter = entityBudget.entities.find((entity) => entity.type === "character");
    if (!includedCharacter) throw new Error("included character missing");
    for (let index = 0; index < 13; index += 1) {
      createFact(values.projectId, { subjectEntityId: includedCharacter.entityId, predicate: "appearance.distinctive_features", value: [`feature-${index}`], valueType: "json", scope: "base", sourceId: excludedSource.id, requestId: `phase4-budget-fact-${index}` }, database);
    }
    const factBudget = buildContextSnapshot(values.projectId, { sceneId: currentScene.sceneId, sceneRevisionId: currentScene.id, purpose: "storyboard", policyId: "storyboard-default-v1", requestId: "phase4-budget-facts" }, database).snapshot.content;
    const contextCharacter = factBudget.entities.find((entity) => entity.entityId === includedCharacter.entityId);
    expect(contextCharacter?.baseFacts).toHaveLength(12);
    expect(factBudget.omitted).toContainEqual(expect.objectContaining({ kind: "fact", entityId: includedCharacter.entityId, reason: "budget" }));
  });

  it("rejects request collisions and preserves the additive v14 migration through the current schema", () => {
    const database = isolatedDatabase();
    const values = fixture(database);
    const input = { sceneId: values.scene.sceneId, sceneRevisionId: values.scene.id, purpose: "storyboard" as const, policyId: "storyboard-default-v1" as const, requestId: "collision" };
    const original = buildContextSnapshot(values.projectId, input, database);
    const laterSource = createEvidenceSource(values.projectId, { kind: "user_input", documentId: values.document.id, sceneId: values.scene.sceneId, sceneRevisionId: values.scene.id, requestId: "phase4-replay-source" }, database);
    createFact(values.projectId, { subjectEntityId: values.character.id, predicate: "identity.age", value: 31, valueType: "number", scope: "base", sourceId: laterSource.id, requestId: "phase4-replay-fact" }, database);
    expect(buildContextSnapshot(values.projectId, input, database)).toMatchObject({ idempotent: true, snapshot: { id: original.snapshot.id } });
    expect(() => buildContextSnapshot(values.projectId, { ...input, purpose: "video", policyId: "video-default-v1", requestId: "collision" }, database)).toThrow(StoryBibleIdempotencyConflictError);
    expect(() => buildContextSnapshot(values.projectId, { ...input, actorId: "another-actor", requestId: "collision" }, database)).toThrow(StoryBibleIdempotencyConflictError);
    expect(CURRENT_SCHEMA_VERSION).toBe(17);
    expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(CURRENT_SCHEMA_VERSION);
    database.exec("DROP TABLE context_snapshots; PRAGMA user_version = 13;");
    bootstrapDatabase(database);
    expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'context_snapshots'").get()).toMatchObject({ name: "context_snapshots" });
  });
});
