import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase } from "./connection";
import { bootstrapDatabase, CURRENT_SCHEMA_VERSION } from "./schema";
import { createDocument, createDocumentRevision, getDocumentRevision, listContinuityGroups } from "./document";
import { createContinuityGroup } from "./document";
import { createEntity, createEvidenceSource, createFact, updateEntity } from "./story-bible";
import { acceptEditedPatch, acceptPatch, getPatch, listPatchStates, proposeFactPatch, proposeStatePatch, rejectPatch } from "./canon-patch";
import { listPatchApplications } from "./canon-patch";
import { listEntityStates, resolveSceneState } from "./scene-state";
import { SceneAnalysisStaleError, StoryBibleIdempotencyConflictError, StoryBibleNotFoundError, StoryBiblePatchConflictError, StoryBiblePatchResolvedError } from "./story-bible-errors";

type Handle = { database: DatabaseSync; directory: string };
const handles: Handle[] = [];

function isolatedDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "story-phase3-"));
  const database = createDatabase(join(directory, "story.db"));
  handles.push({ database, directory });
  return database;
}

function project(database: DatabaseSync, title = "Phase 3") {
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  database.prepare("INSERT INTO projects (id, title, premise, genre, status, created_at, updated_at) VALUES (:id, :title, '', '', 'active', :createdAt, :updatedAt)").run({ id, title, createdAt: timestamp, updatedAt: timestamp });
  return { id };
}

function sourceRevision(database: DatabaseSync, documentId: string, projectId: string, index: number) {
  const document = database.prepare("SELECT current_revision_id FROM script_documents WHERE id = :documentId").get({ documentId }) as { current_revision_id?: string };
  const revision = getDocumentRevision(document.current_revision_id as string, projectId, database);
  const scene = revision?.sceneRevisions[index];
  if (!scene) throw new Error(`scene ${index} is missing`);
  return { revision: revision as NonNullable<typeof revision>, scene };
}

function exactEvidence(database: DatabaseSync, projectId: string, documentId: string, sceneId: string, sceneRevisionId: string, content: string) {
  return { anchorStart: 0, anchorEnd: content.length, quotedText: content };
}

function confirmLink(database: DatabaseSync, projectId: string, sceneId: string, sceneRevisionId: string, entityId: string) {
  const timestamp = new Date().toISOString();
  const id = randomUUID();
  database.prepare("INSERT INTO scene_entity_links (id, project_id, scene_id, scene_revision_id, entity_id, entity_type, role, status, resolver, confidence, version, candidate_group_id, fingerprint, analysis_run_id, created_at, updated_at) VALUES (:id, :projectId, :sceneId, :sceneRevisionId, :entityId, 'character', 'appears', 'confirmed', 'user', 1, 1, :candidateGroupId, :fingerprint, NULL, :createdAt, :updatedAt)").run({ id, projectId, sceneId, sceneRevisionId, entityId, candidateGroupId: randomUUID(), fingerprint: `phase3:${id}`, createdAt: timestamp, updatedAt: timestamp });
}

afterEach(() => {
  while (handles.length > 0) {
    const handle = handles.pop();
    if (!handle) continue;
    handle.database.close();
    rmSync(handle.directory, { recursive: true, force: true });
  }
});

describe("Phase 3 Scene State server", () => {
  it("creates the default group, accepts explicit state, carries to later scenes, and aggregates held props", () => {
    const database = isolatedDatabase();
    const story = project(database);
    const character = createEntity(story.id, { type: "character", canonicalName: "Lin" }, database);
    const propA = createEntity(story.id, { type: "prop", canonicalName: "Key" }, database);
    const propB = createEntity(story.id, { type: "prop", canonicalName: "Coin" }, database);
    const scenes = Array.from({ length: 18 }, (_, index) => ({ title: `Scene ${index + 1}`, content: `Scene ${index + 1} evidence.` }));
    const document = createDocument(story.id, { title: "Script", requestId: "phase3-document", scenes }, database);
    const initial = getDocumentRevision(document.currentRevisionId as string, story.id, database);
    expect(initial?.sceneRevisions).toHaveLength(18);
    const groups = listContinuityGroups(document.id, story.id, database);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: document.id, kind: "main", isDefault: true, version: 1 });
    const scene1 = initial?.sceneRevisions[0];
    const scene7 = initial?.sceneRevisions[6];
    const scene17 = initial?.sceneRevisions[16];
    if (!scene1 || !scene7 || !scene17) throw new Error("scene revisions missing");

    const wardrobeInput = {
      documentId: document.id, sceneId: scene1.sceneId, sceneRevisionId: scene1.id, subjectEntityId: character.id,
      predicate: "wardrobe.current" as const, value: "black coat", carryForward: true, baseVersion: character.version,
      evidence: [exactEvidence(database, story.id, document.id, scene1.sceneId, scene1.id, scene1.content)], requestId: "state-wardrobe",
    };
    const proposal = proposeStatePatch(story.id, wardrobeInput, database);
    expect(proposal.patch.operation).toBe("add_state");
    expect(proposal.patch.modelRunId).toBeNull();
    expect(proposal.patch.inferenceId).toBeNull();
    expect(proposeStatePatch(story.id, wardrobeInput, database).idempotent).toBe(true);
    expect(() => proposeStatePatch(story.id, { ...wardrobeInput, value: "red coat" }, database)).toThrow(StoryBibleIdempotencyConflictError);
    const accepted = acceptPatch(story.id, proposal.patch.id, { expectedVersion: proposal.patch.version, requestId: "state-wardrobe-accept" }, database);
    if (!accepted.state) throw new Error("accepted wardrobe state is missing");
    expect(accepted.state).toMatchObject({ entityId: character.id, predicate: "wardrobe.current", value: "black coat", appliesAtSceneId: scene1.sceneId, sourceRevisionId: scene1.id, continuityGroupId: document.id, carryForward: true, priority: 100, truthClass: "canon", status: "active", version: 1 });
    expect(accepted.application?.resultingStateId).toBe(accepted.state.id);
    expect(acceptPatch(story.id, proposal.patch.id, { expectedVersion: proposal.patch.version, requestId: "state-wardrobe-accept" }, database).idempotent).toBe(true);

    const lowerPriority = proposeStatePatch(story.id, { ...wardrobeInput, value: "lower priority coat", priority: 50, requestId: "state-wardrobe-lower" }, database);
    expect(lowerPriority.patch).toMatchObject({ conflictKind: "none", conflictingStateIds: [] });
    const acceptedLowerPriority = acceptPatch(story.id, lowerPriority.patch.id, { expectedVersion: lowerPriority.patch.version, requestId: "state-wardrobe-lower-accept" }, database);
    expect(acceptedLowerPriority.state).toMatchObject({ value: "lower priority coat", priority: 50 });

    confirmLink(database, story.id, scene7.sceneId, scene7.id, character.id);
    const resolvedLater = resolveSceneState(story.id, scene7.sceneId, scene7.id, undefined, database);
    expect(resolvedLater.entities).toHaveLength(1);
    const wardrobe = resolvedLater.entities[0].fields.find((field) => field.predicate === "wardrobe.current");
    expect(wardrobe).toMatchObject({ tier: "carried", value: "black coat", valueType: "string", cardinality: "single", blockingConflict: false });
    expect(wardrobe?.sources[0]).toMatchObject({ kind: "state", recordId: accepted.state.id, tier: "carried", appliesAtSceneId: scene1.sceneId, sourceRevisionId: scene1.id });

    for (const [value, requestId] of [[propA.id, "held-a"], [propB.id, "held-b"]] as const) {
      const held = proposeStatePatch(story.id, { ...wardrobeInput, predicate: "state.held_prop", value, valueType: "entity_ref", carryForward: false, validToSceneId: null, requestId }, database);
      const result = acceptPatch(story.id, held.patch.id, { expectedVersion: held.patch.version, requestId: `${requestId}-accept` }, database);
      expect(result.state?.value).toBe(value);
    }
    const resolvedExplicit = resolveSceneState(story.id, scene1.sceneId, scene1.id, character.id, database);
    const heldField = resolvedExplicit.entities[0].fields.find((field) => field.predicate === "state.held_prop");
    expect(heldField).toMatchObject({ tier: "explicit", cardinality: "multi", valueType: "entity_ref", blockingConflict: false });
    expect(new Set(heldField?.value as string[])).toEqual(new Set([propA.id, propB.id]));

    const conflictingStateId = randomUUID();
    const createdAt = new Date().toISOString();
    const insertWardrobeState = database.prepare("INSERT INTO entity_states (id, project_id, entity_id, predicate, value_json, value_type, applies_at_scene_id, source_revision_id, continuity_group_id, carry_forward, priority, valid_to_scene_id, source_id, truth_class, status, version, created_at) VALUES (:id, :projectId, :entityId, 'wardrobe.current', :valueJson, 'string', :sceneId, :sceneRevisionId, :continuityGroupId, 0, :priority, NULL, :sourceId, 'canon', 'active', 1, :createdAt)");
    expect(resolveSceneState(story.id, scene1.sceneId, scene1.id, character.id, database).entities[0].fields.find((field) => field.predicate === "wardrobe.current")).toMatchObject({ tier: "explicit", value: "black coat", priority: 100, blockingConflict: false });
    insertWardrobeState.run({ id: conflictingStateId, projectId: story.id, entityId: character.id, valueJson: JSON.stringify("same priority coat"), sceneId: scene1.sceneId, sceneRevisionId: scene1.id, continuityGroupId: document.id, priority: 100, sourceId: accepted.state.sourceId, createdAt });
    const conflictingResolution = resolveSceneState(story.id, scene1.sceneId, scene1.id, character.id, database);
    const conflictingWardrobe = conflictingResolution.entities[0].fields.find((field) => field.predicate === "wardrobe.current");
    expect(conflictingResolution.hasBlockingConflicts).toBe(true);
    expect(conflictingWardrobe).toMatchObject({ tier: "conflict", value: null, priority: 100, blockingConflict: true });
    expect(new Set(conflictingWardrobe?.conflictValues)).toEqual(new Set(["black coat", "same priority coat"]));
    expect(new Set(conflictingWardrobe?.sources.map((source) => source.recordId))).toEqual(new Set([accepted.state.id, conflictingStateId]));

    const boundedInjury = proposeStatePatch(story.id, { ...wardrobeInput, predicate: "state.injury", value: "bandaged arm", carryForward: true, validToSceneId: scene7.sceneId, requestId: "bounded-injury" }, database);
    acceptPatch(story.id, boundedInjury.patch.id, { expectedVersion: boundedInjury.patch.version, requestId: "bounded-injury-accept" }, database);
    expect(resolveSceneState(story.id, scene7.sceneId, scene7.id, character.id, database).entities[0].fields.find((field) => field.predicate === "state.injury")?.value).toBe("bandaged arm");
    expect(resolveSceneState(story.id, scene17.sceneId, scene17.id, character.id, database).entities[0].fields.find((field) => field.predicate === "state.injury")?.tier).toBe("missing");

    const futureInput = {
      ...wardrobeInput,
      predicate: "state.injury" as const,
      value: "future injury",
      carryForward: false,
      validToSceneId: null,
      sceneId: scene17.sceneId,
      sceneRevisionId: scene17.id,
      evidence: [exactEvidence(database, story.id, document.id, scene17.sceneId, scene17.id, scene17.content)],
      requestId: "future-injury",
    };
    const futurePatch = proposeStatePatch(story.id, futureInput, database);
    acceptPatch(story.id, futurePatch.patch.id, { expectedVersion: futurePatch.patch.version, requestId: "future-injury-accept" }, database);
    const beforeFuture = resolveSceneState(story.id, scene7.sceneId, scene7.id, character.id, database);
    expect(beforeFuture.entities[0].fields.find((field) => field.predicate === "state.injury")).toMatchObject({ tier: "carried", value: "bandaged arm" });
    const atFuture = resolveSceneState(story.id, scene17.sceneId, scene17.id, character.id, database);
    expect(atFuture.entities[0].fields.find((field) => field.predicate === "state.injury")?.value).toBe("future injury");
  });

  it("supports base and missing resolution, explicit unlinked characters, edited value-only acceptance, reject, and CAS", () => {
    const database = isolatedDatabase();
    const story = project(database);
    const foreign = project(database, "Foreign");
    const character = createEntity(story.id, { type: "character", canonicalName: "Lin" }, database);
    const unlinked = createEntity(story.id, { type: "character", canonicalName: "Unlinked" }, database);
    const prop = createEntity(story.id, { type: "prop", canonicalName: "Key" }, database);
    const foreignProp = createEntity(foreign.id, { type: "prop", canonicalName: "Foreign key" }, database);
    const content = "A character is here.";
    const document = createDocument(story.id, { title: "Script", requestId: "base-document", scenes: [{ title: "One", content }, { title: "Two", content: "Later." }] }, database);
    const first = sourceRevision(database, document.id, story.id, 0);
    const second = sourceRevision(database, document.id, story.id, 1);
    const evidence = createEvidenceSource(story.id, { kind: "text_span", documentId: document.id, sceneId: first.scene.sceneId, sceneRevisionId: first.scene.id, quotedText: content, requestId: "base-source" }, database);
    createFact(story.id, { subjectEntityId: character.id, predicate: "visual.default_wardrobe", value: "white shirt", valueType: "string", scope: "base", sourceId: evidence.id, requestId: "base-fact" }, database);
    const baseResolved = resolveSceneState(story.id, first.scene.sceneId, first.scene.id, character.id, database);
    expect(baseResolved.entities[0].fields.find((field) => field.predicate === "wardrobe.current")).toMatchObject({ tier: "base", value: "white shirt", cardinality: "single" });
    expect(baseResolved.entities[0].fields.find((field) => field.predicate === "state.injury")).toMatchObject({ tier: "missing", value: null, sources: [] });

    const editedProposal = proposeStatePatch(story.id, { documentId: document.id, sceneId: first.scene.sceneId, sceneRevisionId: first.scene.id, subjectEntityId: unlinked.id, predicate: "wardrobe.current", value: "blue jacket", baseVersion: unlinked.version, evidence: [exactEvidence(database, story.id, document.id, first.scene.sceneId, first.scene.id, content)], requestId: "edited-state" }, database);
    const editedPayload = { ...editedProposal.patch.payload, value: "green jacket" };
    const edited = acceptEditedPatch(story.id, editedProposal.patch.id, { expectedVersion: editedProposal.patch.version, requestId: "edited-state-accept", payload: editedPayload }, database);
    expect(edited.state?.value).toBe("green jacket");
    expect(listPatchStates(story.id, editedProposal.patch.id, database)).toEqual([edited.state]);
    const unlinkedResolved = resolveSceneState(story.id, first.scene.sceneId, first.scene.id, unlinked.id, database);
    expect(unlinkedResolved.entities).toHaveLength(1);
    expect(unlinkedResolved.entities[0].entityId).toBe(unlinked.id);
    expect(unlinkedResolved.entities[0].fields.find((field) => field.predicate === "wardrobe.current")?.value).toBe("green jacket");

    const invalidEdit = proposeStatePatch(story.id, { documentId: document.id, sceneId: second.scene.sceneId, sceneRevisionId: second.scene.id, subjectEntityId: character.id, predicate: "state.held_prop", value: prop.id, valueType: "entity_ref", baseVersion: character.version, evidence: [exactEvidence(database, story.id, document.id, second.scene.sceneId, second.scene.id, "Later.")], requestId: "invalid-edit-source" }, database);
    expect(() => acceptEditedPatch(story.id, invalidEdit.patch.id, { expectedVersion: invalidEdit.patch.version, requestId: "invalid-edit", payload: { ...invalidEdit.patch.payload, value: foreignProp.id } }, database)).toThrow(StoryBibleNotFoundError);

    const rejected = proposeStatePatch(story.id, { documentId: document.id, sceneId: second.scene.sceneId, sceneRevisionId: second.scene.id, subjectEntityId: character.id, predicate: "state.injury", value: "bruise", baseVersion: character.version, evidence: [exactEvidence(database, story.id, document.id, second.scene.sceneId, second.scene.id, "Later.")], requestId: "rejected-state" }, database);
    expect(rejectPatch(story.id, rejected.patch.id, { expectedVersion: rejected.patch.version, requestId: "rejected-state-command" }, database).patch.status).toBe("rejected");

    const cas = proposeStatePatch(story.id, { documentId: document.id, sceneId: second.scene.sceneId, sceneRevisionId: second.scene.id, subjectEntityId: character.id, predicate: "state.injury", value: "cut", baseVersion: character.version, evidence: [exactEvidence(database, story.id, document.id, second.scene.sceneId, second.scene.id, "Later.")], requestId: "cas-state" }, database);
    updateEntity(character.id, { attributes: { changed: true }, baseVersion: character.version, requestId: "cas-entity" }, database);
    expect(() => acceptPatch(story.id, cas.patch.id, { expectedVersion: cas.patch.version, requestId: "cas-state-accept" }, database)).toThrow(StoryBiblePatchConflictError);
  });

  it("blocks state conflicts, isolates continuity groups and documents, and rejects stale revisions", () => {
    const database = isolatedDatabase();
    const story = project(database);
    const character = createEntity(story.id, { type: "character", canonicalName: "Lin" }, database);
    const document = createDocument(story.id, { title: "Groups", requestId: "group-document", scenes: [{ title: "Main", content: "Main." }, { title: "Flashback", content: "Flashback." }] }, database);
    const initial = getDocumentRevision(document.currentRevisionId as string, story.id, database);
    if (!initial) throw new Error("initial revision missing");
    const mainScene = initial.sceneRevisions[0];
    const flashbackScene = initial.sceneRevisions[1];
    const mainProposal = proposeStatePatch(story.id, { documentId: document.id, sceneId: mainScene.sceneId, sceneRevisionId: mainScene.id, subjectEntityId: character.id, predicate: "wardrobe.current", value: "main coat", carryForward: true, baseVersion: character.version, evidence: [exactEvidence(database, story.id, document.id, mainScene.sceneId, mainScene.id, mainScene.content)], requestId: "group-state" }, database);
    acceptPatch(story.id, mainProposal.patch.id, { expectedVersion: mainProposal.patch.version, requestId: "group-state-accept" }, database);
    const stalePending = proposeStatePatch(story.id, { documentId: document.id, sceneId: mainScene.sceneId, sceneRevisionId: mainScene.id, subjectEntityId: character.id, predicate: "state.injury", value: "old bruise", baseVersion: character.version, evidence: [exactEvidence(database, story.id, document.id, mainScene.sceneId, mainScene.id, mainScene.content)], requestId: "stale-state" }, database);

    const groupResult = createContinuityGroup(story.id, document.id, { name: "Flashback lane", kind: "flashback", requestId: "group-create" }, database);
    expect(groupResult.idempotent).toBe(false);
    expect(createContinuityGroup(story.id, document.id, { name: "Flashback lane", kind: "flashback", requestId: "group-create" }, database)).toMatchObject({ idempotent: true, continuityGroup: { id: groupResult.continuityGroup.id } });
    expect(() => createContinuityGroup(story.id, document.id, { name: "Other", kind: "flashback", requestId: "group-create" }, database)).toThrow(StoryBibleIdempotencyConflictError);
    const saved = createDocumentRevision(document.id, { baseVersion: document.version, requestId: "move-flashback", scenes: [
      { id: mainScene.sceneId, title: mainScene.title, content: mainScene.content },
      { id: flashbackScene.sceneId, title: flashbackScene.title, content: flashbackScene.content, continuityGroupId: groupResult.continuityGroup.id },
    ] }, database);
    const current = saved.sceneRevisions;
    const currentMain = current.find((scene) => scene.sceneId === mainScene.sceneId);
    const currentFlashback = current.find((scene) => scene.sceneId === flashbackScene.sceneId);
    if (!currentMain || !currentFlashback) throw new Error("saved scenes missing");
    expect(() => resolveSceneState(story.id, mainScene.sceneId, mainScene.id, character.id, database)).toThrow(SceneAnalysisStaleError);
    expect(() => acceptPatch(story.id, stalePending.patch.id, { expectedVersion: stalePending.patch.version, requestId: "stale-state-accept" }, database)).toThrow(StoryBiblePatchResolvedError);
    expect(getPatch(stalePending.patch.id, story.id, database)?.status).toBe("expired");
    const isolated = resolveSceneState(story.id, currentFlashback.sceneId, currentFlashback.id, character.id, database);
    expect(isolated.entities[0].fields.find((field) => field.predicate === "wardrobe.current")?.tier).toBe("missing");

    const conflicting = proposeStatePatch(story.id, { documentId: document.id, sceneId: currentFlashback.sceneId, sceneRevisionId: currentFlashback.id, subjectEntityId: character.id, predicate: "wardrobe.current", value: "flashback coat", baseVersion: character.version, evidence: [exactEvidence(database, story.id, document.id, currentFlashback.sceneId, currentFlashback.id, currentFlashback.content)], requestId: "group-conflict" }, database);
    expect(conflicting.patch.conflictKind).toBe("none");
    const acceptedConflictSource = acceptPatch(story.id, conflicting.patch.id, { expectedVersion: conflicting.patch.version, requestId: "group-conflict-accept" }, database);
    const second = proposeStatePatch(story.id, { documentId: document.id, sceneId: currentFlashback.sceneId, sceneRevisionId: currentFlashback.id, subjectEntityId: character.id, predicate: "wardrobe.current", value: "another coat", baseVersion: character.version, evidence: [exactEvidence(database, story.id, document.id, currentFlashback.sceneId, currentFlashback.id, currentFlashback.content)], requestId: "group-conflict-2" }, database);
    expect(second.patch.conflictKind).toBe("hard");
    expect(second.patch.conflictingStateIds).toContain(acceptedConflictSource.state?.id);
  });

  it("rejects malformed state rows and raw-SQL acceptance that changes reviewed identity", () => {
    const database = isolatedDatabase();
    const story = project(database);
    const character = createEntity(story.id, { type: "character", canonicalName: "Lin" }, database);
    const location = createEntity(story.id, { type: "location", canonicalName: "Bar" }, database);
    const document = createDocument(story.id, { title: "Guards", requestId: "guard-document", scenes: [{ title: "One", content: "Evidence." }] }, database);
    const current = sourceRevision(database, document.id, story.id, 0);
    const evidence = exactEvidence(database, story.id, document.id, current.scene.sceneId, current.scene.id, current.scene.content);
    const source = createEvidenceSource(story.id, { kind: "text_span", documentId: document.id, sceneId: current.scene.sceneId, sceneRevisionId: current.scene.id, quotedText: current.scene.content, requestId: "guard-source" }, database);
    const groupId = document.id;
    const invalidState = { id: randomUUID(), projectId: story.id, entityId: location.id, predicate: "wardrobe.current", valueJson: JSON.stringify("coat"), valueType: "string", appliesAtSceneId: current.scene.sceneId, sourceRevisionId: current.scene.id, continuityGroupId: groupId, carryForward: 0, priority: 100, validToSceneId: null, sourceId: source.id, truthClass: "canon", status: "active", version: 1, createdAt: new Date().toISOString() };
    expect(() => database.prepare("INSERT INTO entity_states (id, project_id, entity_id, predicate, value_json, value_type, applies_at_scene_id, source_revision_id, continuity_group_id, carry_forward, priority, valid_to_scene_id, source_id, truth_class, status, version, created_at) VALUES (:id, :projectId, :entityId, :predicate, :valueJson, :valueType, :appliesAtSceneId, :sourceRevisionId, :continuityGroupId, :carryForward, :priority, :validToSceneId, :sourceId, :truthClass, :status, :version, :createdAt)").run(invalidState)).toThrow();

    const patch = proposeStatePatch(story.id, { documentId: document.id, sceneId: current.scene.sceneId, sceneRevisionId: current.scene.id, subjectEntityId: character.id, predicate: "wardrobe.current", value: "coat", baseVersion: character.version, evidence: [evidence], requestId: "forged-state" }, database);
    const stateId = randomUUID();
    const createdAt = new Date().toISOString();
    database.prepare("INSERT INTO entity_states (id, project_id, entity_id, predicate, value_json, value_type, applies_at_scene_id, source_revision_id, continuity_group_id, carry_forward, priority, valid_to_scene_id, source_id, truth_class, status, version, created_at) VALUES (:id, :projectId, :entityId, 'wardrobe.current', :valueJson, 'string', :appliesAtSceneId, :sourceRevisionId, :continuityGroupId, 0, 999, NULL, :sourceId, 'canon', 'active', 1, :createdAt)").run({ id: stateId, projectId: story.id, entityId: character.id, valueJson: JSON.stringify("forged value"), appliesAtSceneId: current.scene.sceneId, sourceRevisionId: current.scene.id, continuityGroupId: groupId, sourceId: patch.patch.evidenceSourceIds[0], createdAt });
    const appliedPayload = { ...patch.patch.payload, value: "forged value", priority: 999 };
    database.prepare("INSERT INTO patch_applications (id, project_id, patch_id, operation, resulting_fact_id, resulting_state_id, applied_payload_json, request_id, created_at) VALUES (:id, :projectId, :patchId, 'add_state', NULL, :resultingStateId, :appliedPayloadJson, :requestId, :createdAt)").run({ id: randomUUID(), projectId: story.id, patchId: patch.patch.id, resultingStateId: stateId, appliedPayloadJson: JSON.stringify(appliedPayload), requestId: "forged-accept", createdAt });
    for (const eventType of ["patch.accepted", "story_bible.changed"]) {
      database.prepare("INSERT INTO audit_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, actor_id, request_id, created_at) VALUES (:id, :projectId, :eventType, :aggregateType, :aggregateId, 2, '{}', 'test', 'forged-accept', :createdAt)").run({ id: randomUUID(), projectId: story.id, eventType, aggregateType: eventType === "patch.accepted" ? "pending_patch" : "story_bible", aggregateId: patch.patch.id, createdAt });
      database.prepare("INSERT INTO outbox_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, request_id, status, attempts, available_at, published_at, created_at) VALUES (:id, :projectId, :eventType, :aggregateType, :aggregateId, 2, '{}', 'forged-accept', 'pending', 0, :createdAt, NULL, :createdAt)").run({ id: randomUUID(), projectId: story.id, eventType, aggregateType: eventType === "patch.accepted" ? "pending_patch" : "story_bible", aggregateId: patch.patch.id, createdAt });
    }
    expect(() => database.prepare("UPDATE pending_patches SET status = 'accepted', version = version + 1 WHERE id = :patchId AND status = 'pending' AND version = 1").run({ patchId: patch.patch.id })).toThrow();
    expect(database.prepare("SELECT status FROM pending_patches WHERE id = :patchId").get({ patchId: patch.patch.id })).toMatchObject({ status: "pending" });
    expect(listPatchApplications(story.id, patch.patch.id, database)).toHaveLength(1);
    expect(listEntityStates(story.id, { entityId: character.id }, database)).toHaveLength(1);
  });

  it("migrates a v12-marked database to v13 without losing Phase 2 review history", () => {
    const database = isolatedDatabase();
    const story = project(database, "Migration");
    const character = createEntity(story.id, { type: "character", canonicalName: "Lin" }, database);
    const document = createDocument(story.id, { title: "Migration script", requestId: "migration-document", scenes: [{ title: "One", content: "Lin wears a silver earring." }] }, database);
    const current = sourceRevision(database, document.id, story.id, 0);
    const quote = "silver earring";
    const anchorStart = current.scene.content.indexOf(quote);
    const proposal = proposeFactPatch(story.id, {
      documentId: document.id,
      sceneId: current.scene.sceneId,
      sceneRevisionId: current.scene.id,
      operation: "add_fact",
      subjectEntityId: character.id,
      predicate: "appearance.distinctive_features",
      value: [quote],
      valueType: "json",
      scope: "base",
      evidence: [{ anchorStart, anchorEnd: anchorStart + quote.length, quotedText: quote }],
      requestId: "migration-fact",
    }, database);
    const accepted = acceptPatch(story.id, proposal.patch.id, { expectedVersion: proposal.patch.version, requestId: "migration-fact-accept" }, database);
    const applicationId = accepted.application?.id;
    const evidenceSourceId = proposal.patch.evidenceSourceIds[0];
    if (!applicationId || !evidenceSourceId || !accepted.fact) throw new Error("Phase 2 review fixture is incomplete");

    database.exec("PRAGMA foreign_keys = OFF; DROP TABLE entity_states; DROP TABLE continuity_groups; PRAGMA user_version = 12; PRAGMA foreign_keys = ON;");
    bootstrapDatabase(database);

    expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(listContinuityGroups(document.id, story.id, database)).toEqual([expect.objectContaining({ id: document.id, documentId: document.id, kind: "main", isDefault: true })]);
    expect(getPatch(proposal.patch.id, story.id, database)).toMatchObject({ id: proposal.patch.id, operation: "add_fact", status: "accepted", conflictingStateIds: [] });
    expect(listPatchApplications(story.id, proposal.patch.id, database)).toEqual([expect.objectContaining({ id: applicationId, resultingFactId: accepted.fact.id, resultingStateId: null })]);
    expect(database.prepare("SELECT project_id, patch_id, evidence_source_id FROM patch_evidence WHERE patch_id = :patchId").get({ patchId: proposal.patch.id })).toEqual({ project_id: story.id, patch_id: proposal.patch.id, evidence_source_id: evidenceSourceId });
    expect(() => proposeStatePatch(story.id, { documentId: document.id, sceneId: current.scene.sceneId, sceneRevisionId: current.scene.id, subjectEntityId: character.id, predicate: "state.injury", value: "bruise", baseVersion: character.version, evidence: [exactEvidence(database, story.id, document.id, current.scene.sceneId, current.scene.id, current.scene.content)], requestId: "migration-state" }, database)).not.toThrow();
  });
});
