import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase } from "@/server/db/connection";
import { bootstrapDatabase, CURRENT_SCHEMA_VERSION } from "@/server/db/schema";
import { randomUUID } from "node:crypto";
import { createProject } from "@/server/db/projects";
import { createDocument, createDocumentRevision, getDocumentRevision } from "@/server/db/document";
import { createEntity, createEvidenceSource, createFact, listFacts, updateEntity } from "@/server/db/story-bible";
import { acceptEditedPatch, acceptPatch, getPatch, listInferences, listPatches, proposeFactPatch, rejectPatch, revalidateSceneFactPatches } from "@/server/db/canon-patch";
import { StoryBibleIdempotencyConflictError, StoryBiblePatchConflictError, StoryBibleValidationError } from "@/server/db/story-bible-errors";

let databaseDirectory = "";

describe("Phase 2 Canon / Inference / Pending Patch", () => {
  beforeEach(() => {
    databaseDirectory = mkdtempSync(join(tmpdir(), "story-phase2-"));
    process.env.STORY_WORKSPACE_DB_PATH = join(databaseDirectory, "story.db");
  });

  afterEach(() => {
    closeDatabase();
    delete process.env.STORY_WORKSPACE_DB_PATH;
    rmSync(databaseDirectory, { recursive: true, force: true });
  });

  it("persists a schema-valid inference and promotes it to Canon with provenance", () => {
    const project = createProject({ title: "Patch loop" });
    const character = createEntity(project.id, { type: "character", canonicalName: "林默" });
    const content = "林默摸了摸左耳的银色耳钉。";
    const document = createDocument(project.id, { title: "Script", requestId: "doc", scenes: [{ title: "One", content }] });
    const scene = getDocumentRevision(document.currentRevisionId as string, project.id)?.sceneRevisions[0];
    if (!scene) throw new Error("scene missing");
    const quote = "左耳的银色耳钉";
    const start = content.indexOf(quote);
    const proposal = proposeFactPatch(project.id, {
      documentId: document.id,
      sceneId: scene.sceneId,
      sceneRevisionId: scene.id,
      operation: "add_fact",
      subjectEntityId: character.id,
      predicate: "appearance.distinctive_features",
      value: ["左耳佩戴银色耳钉"],
      valueType: "json",
      scope: "base",
      evidence: [{ anchorStart: start, anchorEnd: start + quote.length, quotedText: quote }],
      confidence: 0.98,
      requestId: "propose-1",
    });
    expect(proposal.patch.status).toBe("pending");
    expect(proposal.patch.truthClass).toBe("canon");
    expect(proposal.patch.conflictKind).toBe("none");
    expect(proposal.inference?.status).toBe("active");
    expect(proposal.modelRun?.status).toBe("succeeded");
    expect(proposal.patch.evidenceSourceIds).toHaveLength(1);

    const accepted = acceptPatch(project.id, proposal.patch.id, { expectedVersion: proposal.patch.version, requestId: "accept-1" });
    expect(accepted.patch.status).toBe("accepted");
    expect(accepted.fact?.truthClass).toBe("canon");
    expect(accepted.fact?.promotedFromInferenceId).toBe(proposal.inference?.id);
    expect(accepted.fact?.sourceId).toBe(proposal.patch.evidenceSourceIds[0]);
    expect(listFacts(project.id, { subjectEntityId: character.id }).map((fact) => fact.status)).toEqual(["active"]);
    expect(listInferences(project.id).map((inference) => inference.status)).toEqual(["promoted"]);
    expect(getPatch(proposal.patch.id, project.id)?.status).toBe("accepted");
    expect(listPatches(project.id, { status: "accepted" })).toHaveLength(1);
  });

  it("rejects hard cardinality conflicts without last-write-wins", () => {
    const project = createProject({ title: "Conflict" });
    const character = createEntity(project.id, { type: "character", canonicalName: "林默" });
    const content = "林默的眼睛是蓝色。";
    const document = createDocument(project.id, { title: "Script", requestId: "doc", scenes: [{ title: "One", content }] });
    const scene = getDocumentRevision(document.currentRevisionId as string, project.id)?.sceneRevisions[0];
    if (!scene) throw new Error("scene missing");
    const source = createEvidenceSource(project.id, { kind: "text_span", documentId: document.id, sceneId: scene.sceneId, sceneRevisionId: scene.id, anchorStart: "0", anchorEnd: String(content.length), quotedText: content, requestId: "source" });
    const existing = createFact(project.id, { subjectEntityId: character.id, predicate: "appearance.hair", value: "black", valueType: "string", scope: "base", sourceId: source.id, requestId: "fact" });
    const proposal = proposeFactPatch(project.id, { documentId: document.id, sceneId: scene.sceneId, sceneRevisionId: scene.id, operation: "add_fact", subjectEntityId: character.id, predicate: "appearance.hair", value: "silver", valueType: "string", scope: "base", evidence: [{ anchorStart: 0, anchorEnd: content.length, quotedText: content }], requestId: "conflict" });
    expect(proposal.patch.conflictKind).toBe("hard");
    expect(proposal.patch.conflictingFactIds).toContain(existing.id);
    expect(() => acceptPatch(project.id, proposal.patch.id, { expectedVersion: 1, requestId: "accept-conflict" })).toThrow(StoryBiblePatchConflictError);
    expect(listFacts(project.id, { subjectEntityId: character.id, predicate: "appearance.hair" }).filter((fact) => fact.status === "active")).toHaveLength(1);
  });

  it("supports edited acceptance, rejection, CAS, request collisions, and semantic suppression", () => {
    const project = createProject({ title: "Review" });
    const character = createEntity(project.id, { type: "character", canonicalName: "林默" });
    const other = createEntity(project.id, { type: "character", canonicalName: "夏禾" });
    const content = "林默穿着黑色风衣。";
    const document = createDocument(project.id, { title: "Script", requestId: "doc", scenes: [{ title: "One", content }] });
    const scene = getDocumentRevision(document.currentRevisionId as string, project.id)?.sceneRevisions[0];
    if (!scene) throw new Error("scene missing");
    const input = { documentId: document.id, sceneId: scene.sceneId, sceneRevisionId: scene.id, operation: "add_fact" as const, subjectEntityId: character.id, predicate: "appearance.face", value: "冷峻", valueType: "string" as const, scope: "base" as const, evidence: [{ anchorStart: 0, anchorEnd: content.length, quotedText: content }] };
    const first = proposeFactPatch(project.id, { ...input, requestId: "same-request" });
    const retry = proposeFactPatch(project.id, { ...input, requestId: "same-request" });
    expect(retry.idempotent).toBe(true);
    expect(() => proposeFactPatch(project.id, { ...input, value: "温和", requestId: "same-request" })).toThrow(StoryBibleIdempotencyConflictError);
    const rejected = rejectPatch(project.id, first.patch.id, { expectedVersion: 1, requestId: "reject" });
    expect(rejected.patch.status).toBe("rejected");
    expect(listInferences(project.id).find((inference) => inference.id === first.inference?.id)?.status).toBe("dismissed");
    const suppressed = proposeFactPatch(project.id, { ...input, requestId: "different-request" });
    expect(suppressed.patch.id).toBe(first.patch.id);
    expect(suppressed.idempotent).toBe(true);

    const edit = proposeFactPatch(project.id, { ...input, predicate: "appearance.hair", value: "black", requestId: "edit-proposal" });
    const subjectGuard = proposeFactPatch(project.id, { ...input, predicate: "appearance.distinctive_features", value: ["scar"], valueType: "json", requestId: "subject-guard-proposal" });
    expect(() => acceptEditedPatch(project.id, subjectGuard.patch.id, { expectedVersion: subjectGuard.patch.version, requestId: "subject-guard-accept", payload: { subjectEntityId: other.id, predicate: "appearance.distinctive_features", value: ["scar"], valueType: "json", scope: "base", sceneId: null, validFromSceneId: null, validToSceneId: null } })).toThrow(StoryBibleValidationError);
    rejectPatch(project.id, subjectGuard.patch.id, { expectedVersion: subjectGuard.patch.version, requestId: "subject-guard-reject" });
    const editedPayload = { subjectEntityId: character.id, predicate: "appearance.hair", value: "silver", valueType: "string" as const, scope: "base" as const, sceneId: null, validFromSceneId: null, validToSceneId: null };
    const edited = acceptEditedPatch(project.id, edit.patch.id, { expectedVersion: 1, requestId: "edit-accept", payload: editedPayload });
    expect(edited.fact?.value).toBe("silver");
    expect(edited.application?.appliedPayload).toMatchObject({ value: "silver" });
    const replay = acceptEditedPatch(project.id, edit.patch.id, { expectedVersion: 1, requestId: "edit-accept", payload: editedPayload });
    expect(replay.idempotent).toBe(true);
    expect(replay.application?.patchId).toBe(edit.patch.id);
    expect(() => acceptEditedPatch(project.id, edit.patch.id, { expectedVersion: 1, requestId: "edit-accept", actorId: "different-actor", payload: editedPayload })).toThrow(StoryBibleIdempotencyConflictError);

    const cas = proposeFactPatch(project.id, { ...input, predicate: "appearance.distinctive_features", value: ["tattoo"], valueType: "json", requestId: "cas-proposal" });
    updateEntity(character.id, { attributes: { changed: true }, expectedVersion: 1, requestId: "entity-change" });
    expect(() => acceptPatch(project.id, cas.patch.id, { expectedVersion: cas.patch.version, requestId: "cas-accept" })).toThrow(StoryBiblePatchConflictError);
  });

  it("expires a pending patch when its source revision drifts", () => {
    const project = createProject({ title: "Stale" });
    const character = createEntity(project.id, { type: "character", canonicalName: "林默" });
    const content = "林默摸了摸银色耳钉。";
    const document = createDocument(project.id, { title: "Script", requestId: "doc", scenes: [{ title: "One", content }] });
    const oldScene = getDocumentRevision(document.currentRevisionId as string, project.id)?.sceneRevisions[0];
    if (!oldScene) throw new Error("scene missing");
    const proposal = proposeFactPatch(project.id, { documentId: document.id, sceneId: oldScene.sceneId, sceneRevisionId: oldScene.id, operation: "add_fact", subjectEntityId: character.id, predicate: "appearance.distinctive_features", value: ["银色耳钉"], valueType: "json", scope: "base", evidence: [{ anchorStart: 0, anchorEnd: content.length, quotedText: content }], requestId: "stale-proposal" });
    createDocumentRevision(document.id, { baseVersion: document.version, requestId: "new-revision", scenes: [{ id: oldScene.sceneId, title: "One", content: "林默离开了。" }] });
    expect(() => acceptPatch(project.id, proposal.patch.id, { expectedVersion: 1, requestId: "stale-accept" })).toThrow();
    expect(getPatch(proposal.patch.id, project.id)?.status).toBe("expired");
    expect(listFacts(project.id, { subjectEntityId: character.id })).toHaveLength(0);
  });

  it("enforces project guards and immutable patch payloads at the database boundary", () => {
    const project = createProject({ title: "A" });
    const foreign = createProject({ title: "B" });
    const character = createEntity(project.id, { type: "character", canonicalName: "林默" });
    const document = createDocument(project.id, { title: "Script", requestId: "doc", scenes: [{ title: "One", content: "林默。" }] });
    const scene = getDocumentRevision(document.currentRevisionId as string, project.id)?.sceneRevisions[0];
    if (!scene) throw new Error("scene missing");
    expect(() => proposeFactPatch(foreign.id, { documentId: document.id, sceneId: scene.sceneId, sceneRevisionId: scene.id, operation: "add_fact", subjectEntityId: character.id, predicate: "appearance.face", value: "x", valueType: "string", scope: "base", evidence: [{ anchorStart: 0, anchorEnd: 2, quotedText: "林默" }], requestId: "foreign" })).toThrow();
    const proposal = proposeFactPatch(project.id, { documentId: document.id, sceneId: scene.sceneId, sceneRevisionId: scene.id, operation: "add_fact", subjectEntityId: character.id, predicate: "appearance.face", value: "x", valueType: "string", scope: "base", evidence: [{ anchorStart: 0, anchorEnd: 2, quotedText: "林默" }], requestId: "immutable" });
    const database = getDatabase();
    expect(() => database.prepare("UPDATE pending_patches SET payload_json = '{}' WHERE id = :id").run({ id: proposal.patch.id })).toThrow();
    expect(() => database.prepare("UPDATE pending_patches SET status = 'accepted', version = version + 1 WHERE id = :id").run({ id: proposal.patch.id })).toThrow();
    expect(() => database.prepare("INSERT INTO pending_patches (id, project_id, operation, target_entity_id, target_fact_id, base_version, payload_json, input_fingerprint, truth_class, source_revision_id, status, proposed_by, version, created_at) VALUES (:id, :projectId, 'add_fact', :targetEntityId, NULL, 1, '{}', :fingerprint, 'inferred', :sourceRevisionId, 'pending', 'import', 1, :createdAt)").run({ id: randomUUID(), projectId: project.id, targetEntityId: character.id, fingerprint: randomUUID(), sourceRevisionId: scene.id, createdAt: new Date().toISOString() })).toThrow();
    expect(() => database.prepare("INSERT INTO pending_patches (id, project_id, operation, target_entity_id, target_fact_id, base_version, payload_json, input_fingerprint, truth_class, source_revision_id, status, proposed_by, version, created_at) VALUES (:id, :projectId, 'add_fact', NULL, NULL, NULL, '{}', :fingerprint, 'canon', :sourceRevisionId, 'pending', 'import', 1, :createdAt)").run({ id: randomUUID(), projectId: project.id, fingerprint: randomUUID(), sourceRevisionId: scene.id, createdAt: new Date().toISOString() })).toThrow();
    const forgedFact = createFact(project.id, { subjectEntityId: character.id, predicate: "appearance.face", value: "forged", valueType: "string", scope: "base", sourceId: proposal.patch.evidenceSourceIds[0], requestId: "forged-fact" });
    const requestId = "forged-accept";
    database.prepare("INSERT INTO patch_applications (id, project_id, patch_id, operation, resulting_fact_id, applied_payload_json, request_id, created_at) VALUES (:id, :projectId, :patchId, 'add_fact', :resultingFactId, :appliedPayloadJson, :requestId, :createdAt)").run({ id: randomUUID(), projectId: project.id, patchId: proposal.patch.id, resultingFactId: forgedFact.id, appliedPayloadJson: JSON.stringify(proposal.patch.payload), requestId, createdAt: new Date().toISOString() });
    for (const eventType of ["patch.accepted", "story_bible.changed"]) {
      database.prepare("INSERT INTO audit_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, actor_id, request_id, created_at) VALUES (:id, :projectId, :eventType, 'pending_patch', :aggregateId, 2, '{}', 'direct-test', :requestId, :createdAt)").run({ id: randomUUID(), projectId: project.id, eventType, aggregateId: proposal.patch.id, requestId, createdAt: new Date().toISOString() });
      database.prepare("INSERT INTO outbox_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, request_id, status, attempts, available_at, published_at, created_at) VALUES (:id, :projectId, :eventType, 'pending_patch', :aggregateId, 2, '{}', :requestId, 'pending', 0, :availableAt, NULL, :createdAt)").run({ id: randomUUID(), projectId: project.id, eventType, aggregateId: proposal.patch.id, requestId, availableAt: new Date().toISOString(), createdAt: new Date().toISOString() });
    }
    expect(() => database.prepare("UPDATE pending_patches SET status = 'accepted', version = version + 1 WHERE id = :id AND status = 'pending' AND version = 1").run({ id: proposal.patch.id })).toThrow();
    expect(getPatch(proposal.patch.id, project.id)?.status).toBe("pending");
  });

  it("applies replace_fact as an append-only Canon supersede", () => {
    const project = createProject({ title: "Replace" });
    const character = createEntity(project.id, { type: "character", canonicalName: "林默" });
    const content = "林默的头发是黑色。";
    const document = createDocument(project.id, { title: "Script", requestId: "replace-doc", scenes: [{ title: "One", content }] });
    const scene = getDocumentRevision(document.currentRevisionId as string, project.id)?.sceneRevisions[0];
    if (!scene) throw new Error("scene missing");
    const source = createEvidenceSource(project.id, { kind: "text_span", documentId: document.id, sceneId: scene.sceneId, sceneRevisionId: scene.id, anchorStart: "0", anchorEnd: String(content.length), quotedText: content, requestId: "replace-source" });
    const original = createFact(project.id, { subjectEntityId: character.id, predicate: "appearance.hair", value: "black", valueType: "string", scope: "base", sourceId: source.id, requestId: "replace-fact" });
    const proposal = proposeFactPatch(project.id, { documentId: document.id, sceneId: scene.sceneId, sceneRevisionId: scene.id, operation: "replace_fact", subjectEntityId: character.id, predicate: "appearance.hair", value: "silver", valueType: "string", scope: "base", targetFactId: original.id, baseVersion: original.version, evidence: [{ anchorStart: 0, anchorEnd: content.length, quotedText: content }], requestId: "replace-proposal" });
    const accepted = acceptPatch(project.id, proposal.patch.id, { expectedVersion: proposal.patch.version, requestId: "replace-accept" });
    expect(accepted.fact?.status).toBe("active");
    expect(accepted.fact?.value).toBe("silver");
    expect(accepted.fact?.supersedesFactId).toBe(original.id);
    expect(listFacts(project.id, { subjectEntityId: character.id, predicate: "appearance.hair" }).map((fact) => [fact.id, fact.status])).toEqual([[original.id, "superseded"], [accepted.fact?.id, "active"]]);
  });

  it("detects scene/range overlap by narrative rank and rejects malformed scope shapes", () => {
    const project = createProject({ title: "Scope overlap" });
    const character = createEntity(project.id, { type: "character", canonicalName: "林默" });
    const scenes = ["A", "B", "C", "D"].map((label) => ({ title: label, content: `林默在场景${label}。` }));
    const document = createDocument(project.id, { title: "Script", requestId: "scope-document", scenes });
    const revision = getDocumentRevision(document.currentRevisionId as string, project.id);
    if (!revision) throw new Error("revision missing");
    const byTitle = new Map(revision.sceneRevisions.map((scene) => [scene.title, scene]));
    const sceneA = byTitle.get("A");
    const sceneB = byTitle.get("B");
    const sceneC = byTitle.get("C");
    const sceneD = byTitle.get("D");
    if (!sceneA || !sceneB || !sceneC || !sceneD) throw new Error("scenes missing");
    const evidenceFor = (scene: typeof sceneA, requestId: string) => createEvidenceSource(project.id, { kind: "text_span", documentId: document.id, sceneId: scene.sceneId, sceneRevisionId: scene.id, anchorStart: "0", anchorEnd: String(scene.content.length), quotedText: scene.content, requestId });
    const rangeEvidence = evidenceFor(sceneA, "range-source");
    const initial = createFact(project.id, { subjectEntityId: character.id, predicate: "state.hair", value: "black", valueType: "string", scope: "range", validFromSceneId: sceneA.sceneId, validToSceneId: sceneB.sceneId, sourceId: rangeEvidence.id, requestId: "range-fact" });
    expect(initial.scope).toBe("range");
    const directOverlapSource = evidenceFor(sceneB, "direct-overlap-source");
    expect(() => createFact(project.id, { subjectEntityId: character.id, predicate: "state.hair", value: "gold", valueType: "string", scope: "scene", sceneId: sceneB.sceneId, sourceId: directOverlapSource.id, requestId: "direct-overlap-fact" })).toThrow(StoryBibleValidationError);

    const sceneOverlap = proposeFactPatch(project.id, { documentId: document.id, sceneId: sceneB.sceneId, sceneRevisionId: sceneB.id, operation: "add_fact", subjectEntityId: character.id, predicate: "state.hair", value: "silver", valueType: "string", scope: "scene", evidence: [{ anchorStart: 0, anchorEnd: sceneB.content.length, quotedText: sceneB.content }], requestId: "scene-overlap" });
    expect(sceneOverlap.patch.conflictKind).toBe("hard");
    const rangeOverlap = proposeFactPatch(project.id, { documentId: document.id, sceneId: sceneC.sceneId, sceneRevisionId: sceneC.id, operation: "add_fact", subjectEntityId: character.id, predicate: "state.hair", value: "red", valueType: "string", scope: "range", validFromSceneId: sceneB.sceneId, validToSceneId: sceneC.sceneId, evidence: [{ anchorStart: 0, anchorEnd: sceneC.content.length, quotedText: sceneC.content }], requestId: "range-overlap" });
    expect(rangeOverlap.patch.conflictKind).toBe("hard");
    const disjoint = proposeFactPatch(project.id, { documentId: document.id, sceneId: sceneD.sceneId, sceneRevisionId: sceneD.id, operation: "add_fact", subjectEntityId: character.id, predicate: "state.hair", value: "white", valueType: "string", scope: "range", validFromSceneId: sceneC.sceneId, validToSceneId: sceneD.sceneId, evidence: [{ anchorStart: 0, anchorEnd: sceneD.content.length, quotedText: sceneD.content }], requestId: "range-disjoint" });
    expect(disjoint.patch.conflictKind).toBe("none");
    const raceSource = evidenceFor(sceneD, "range-race-source");
    createFact(project.id, { subjectEntityId: character.id, predicate: "state.hair", value: "green", valueType: "string", scope: "range", validFromSceneId: sceneC.sceneId, validToSceneId: sceneD.sceneId, sourceId: raceSource.id, requestId: "range-race-fact" });
    expect(() => acceptPatch(project.id, disjoint.patch.id, { expectedVersion: disjoint.patch.version, requestId: "range-disjoint-accept" })).toThrow(StoryBiblePatchConflictError);

    expect(() => proposeFactPatch(project.id, { documentId: document.id, sceneId: sceneC.sceneId, sceneRevisionId: sceneC.id, operation: "add_fact", subjectEntityId: character.id, predicate: "appearance.face", value: "冷峻", valueType: "string", scope: "range", validFromSceneId: sceneD.sceneId, validToSceneId: sceneA.sceneId, evidence: [{ anchorStart: 0, anchorEnd: sceneC.content.length, quotedText: sceneC.content }], requestId: "range-reversed" })).toThrow(StoryBibleValidationError);
    expect(() => proposeFactPatch(project.id, { documentId: document.id, sceneId: sceneC.sceneId, sceneRevisionId: sceneC.id, operation: "add_fact", subjectEntityId: character.id, predicate: "appearance.face", value: "温和", valueType: "string", scope: "scene", factSceneId: sceneC.sceneId, validFromSceneId: sceneA.sceneId, evidence: [{ anchorStart: 0, anchorEnd: sceneC.content.length, quotedText: sceneC.content }], requestId: "scene-with-range" })).toThrow(StoryBibleValidationError);
    const directSource = evidenceFor(sceneC, "direct-invalid-scope");
    expect(() => createFact(project.id, { subjectEntityId: character.id, predicate: "appearance.face", value: "温和", valueType: "string", scope: "scene", sceneId: sceneC.sceneId, validFromSceneId: sceneA.sceneId, sourceId: directSource.id, requestId: "direct-invalid-scope-fact" })).toThrow(StoryBibleValidationError);
    const database = getDatabase();
    expect(() => database.prepare("INSERT INTO facts (id, project_id, subject_entity_id, predicate, value_json, value_type, truth_class, scope, scene_id, valid_from_scene_id, valid_to_scene_id, source_id, status, version, created_at) VALUES (:id, :projectId, :subjectEntityId, 'appearance.face', 'null', 'string', 'canon', 'scene', :sceneId, :validFromSceneId, NULL, :sourceId, 'active', 1, :createdAt)").run({ id: randomUUID(), projectId: project.id, subjectEntityId: character.id, sceneId: sceneC.sceneId, validFromSceneId: sceneA.sceneId, sourceId: rangeEvidence.id, createdAt: new Date().toISOString() })).toThrow();
  });

  it("rejects cross-project entity_ref facts in the repository and SQLite trigger", () => {
    const project = createProject({ title: "A" });
    const foreign = createProject({ title: "B" });
    const subject = createEntity(project.id, { type: "character", canonicalName: "林默" });
    const foreignLocation = createEntity(foreign.id, { type: "location", canonicalName: "酒吧" });
    const document = createDocument(project.id, { title: "Script", requestId: "document", scenes: [{ title: "One", content: "林默。" }] });
    const scene = getDocumentRevision(document.currentRevisionId as string, project.id)?.sceneRevisions[0];
    if (!scene) throw new Error("scene missing");
    const source = createEvidenceSource(project.id, { kind: "text_span", documentId: document.id, sceneId: scene.sceneId, sceneRevisionId: scene.id, anchorStart: "0", anchorEnd: "2", quotedText: "林默", requestId: "entity-ref-source" });
    expect(() => createFact(project.id, { subjectEntityId: subject.id, predicate: "state.location", value: foreignLocation.id, valueType: "entity_ref", scope: "scene", sceneId: scene.sceneId, sourceId: source.id, requestId: "foreign-ref" })).toThrow();
    const database = getDatabase();
    expect(() => database.prepare("INSERT INTO facts (id, project_id, subject_entity_id, predicate, value_json, value_type, truth_class, scope, scene_id, source_id, status, version, created_at) VALUES (:id, :projectId, :subjectEntityId, 'state.location', :valueJson, 'entity_ref', 'canon', 'scene', :sceneId, :sourceId, 'active', 1, :createdAt)").run({ id: randomUUID(), projectId: project.id, subjectEntityId: subject.id, valueJson: JSON.stringify(foreignLocation.id), sceneId: scene.sceneId, sourceId: source.id, createdAt: new Date().toISOString() })).toThrow();
    const validProposal = proposeFactPatch(project.id, { documentId: document.id, sceneId: scene.sceneId, sceneRevisionId: scene.id, operation: "add_fact", subjectEntityId: subject.id, predicate: "appearance.face", value: "冷峻", valueType: "string", scope: "base", evidence: [{ anchorStart: 0, anchorEnd: 2, quotedText: "林默" }], requestId: "inference-run" });
    const modelRunId = validProposal.modelRun?.id;
    if (!modelRunId) throw new Error("model run missing");
    expect(modelRunId).toBeTruthy();
    expect(() => database.prepare("INSERT INTO inferences (id, project_id, subject_entity_id, predicate, value_json, value_type, scope, scene_id, valid_from_scene_id, valid_to_scene_id, confidence, rationale, model_run_id, status, version, created_at) VALUES (:id, :projectId, :subjectEntityId, 'state.location', :valueJson, 'entity_ref', 'base', NULL, NULL, NULL, 0.5, NULL, :modelRunId, 'active', 1, :createdAt)").run({ id: randomUUID(), projectId: project.id, subjectEntityId: subject.id, valueJson: JSON.stringify(foreignLocation.id), modelRunId, createdAt: new Date().toISOString() })).toThrow();
  });

  it("creates a revision-bound retract suggestion when accepted evidence disappears", () => {
    const project = createProject({ title: "Revalidation" });
    const character = createEntity(project.id, { type: "character", canonicalName: "林默" });
    const original = "林默佩戴银色耳钉。";
    const document = createDocument(project.id, { title: "Script", requestId: "doc", scenes: [{ title: "One", content: original }] });
    const oldScene = getDocumentRevision(document.currentRevisionId as string, project.id)?.sceneRevisions[0];
    if (!oldScene) throw new Error("scene missing");
    const quote = "银色耳钉";
    const start = original.indexOf(quote);
    const proposal = proposeFactPatch(project.id, { documentId: document.id, sceneId: oldScene.sceneId, sceneRevisionId: oldScene.id, operation: "add_fact", subjectEntityId: character.id, predicate: "appearance.distinctive_features", value: [quote], valueType: "json", scope: "base", evidence: [{ anchorStart: start, anchorEnd: start + quote.length, quotedText: quote }], requestId: "revalidation-proposal" });
    const accepted = acceptPatch(project.id, proposal.patch.id, { expectedVersion: 1, requestId: "revalidation-accept" });
    if (!accepted.fact) throw new Error("fact missing");
    const next = createDocumentRevision(document.id, { baseVersion: document.version, requestId: "revalidation-revision", scenes: [{ id: oldScene.sceneId, title: "One", content: "林默离开了。" }] });
    const pending = listPatches(project.id, { status: "pending" }).filter((patch) => patch.operation === "retract_fact" && patch.targetFactId === accepted.fact?.id);
    expect(pending).toHaveLength(1);
    expect(pending[0].sourceRevisionId).toBe(next.sceneRevisions[0].id);
    expect(listFacts(project.id, { subjectEntityId: character.id }).find((fact) => fact.id === accepted.fact?.id)?.status).toBe("active");
    expect(revalidateSceneFactPatches(project.id, oldScene.sceneId, next.sceneRevisions[0].id)).toHaveLength(1);
    const retracted = acceptPatch(project.id, pending[0].id, { expectedVersion: pending[0].version, requestId: "revalidation-retract" });
    expect(retracted.fact?.status).toBe("retracted");
  });

  it("creates and accepts a retract suggestion for a deleted Scene without resurrecting text", () => {
    const project = createProject({ title: "Deleted scene" });
    const character = createEntity(project.id, { type: "character", canonicalName: "林默" });
    const original = "林默佩戴银色耳钉。";
    const document = createDocument(project.id, { title: "Script", requestId: "document", scenes: [{ title: "One", content: original }] });
    const oldScene = getDocumentRevision(document.currentRevisionId as string, project.id)?.sceneRevisions[0];
    if (!oldScene) throw new Error("scene missing");
    const quote = "银色耳钉";
    const start = original.indexOf(quote);
    const proposal = proposeFactPatch(project.id, { documentId: document.id, sceneId: oldScene.sceneId, sceneRevisionId: oldScene.id, operation: "add_fact", subjectEntityId: character.id, predicate: "appearance.distinctive_features", value: [quote], valueType: "json", scope: "base", evidence: [{ anchorStart: start, anchorEnd: start + quote.length, quotedText: quote }], requestId: "deleted-proposal" });
    const accepted = acceptPatch(project.id, proposal.patch.id, { expectedVersion: 1, requestId: "deleted-accept" });
    const deleted = createDocumentRevision(document.id, { baseVersion: document.version, requestId: "delete-scene", scenes: [{ id: oldScene.sceneId, title: "One", content: "", status: "deleted" }] });
    const pending = listPatches(project.id, { status: "pending" }).find((patch) => patch.operation === "retract_fact" && patch.targetFactId === accepted.fact?.id);
    expect(pending).toBeDefined();
    expect(pending?.sourceRevisionId).toBe(deleted.sceneRevisions[0].id);
    const retracted = acceptPatch(project.id, pending?.id as string, { expectedVersion: pending?.version as number, requestId: "deleted-retract" });
    expect(retracted.fact?.status).toBe("retracted");
  });

  it("requires a succeeded source-bound model run and uniform patch evidence provenance", () => {
    const project = createProject({ title: "Model provenance" });
    const character = createEntity(project.id, { type: "character", canonicalName: "林默" });
    const firstDocument = createDocument(project.id, { title: "First", requestId: "provenance-first-document", scenes: [{ title: "One", content: "林默。" }] });
    const firstScene = getDocumentRevision(firstDocument.currentRevisionId as string, project.id)?.sceneRevisions[0];
    if (!firstScene) throw new Error("first scene missing");
    const secondDocument = createDocument(project.id, { title: "Second", requestId: "provenance-second-document", scenes: [{ title: "Two", content: "另一处。" }] });
    const secondScene = getDocumentRevision(secondDocument.currentRevisionId as string, project.id)?.sceneRevisions[0];
    if (!secondScene) throw new Error("second scene missing");
    const database = getDatabase();
    database.exec("DROP TRIGGER IF EXISTS pending_patches_accepted_model_provenance_guard; PRAGMA user_version = 11;");
    bootstrapDatabase(database);
    expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(CURRENT_SCHEMA_VERSION);

    const modelRunId = randomUUID();
    const createdAt = new Date().toISOString();
    database.prepare("INSERT INTO model_runs (id, project_id, kind, model, model_version, source_revision_id, input_hash, status, output_hash, error_code, error_message, created_at, completed_at) VALUES (:id, :projectId, 'fact_extractor', 'direct-test', 'v1', :sourceRevisionId, 'input', 'failed', NULL, 'TEST_FAILED', 'failed fixture', :createdAt, NULL)").run({ id: modelRunId, projectId: project.id, sourceRevisionId: firstScene.id, createdAt });
    const evidence = createEvidenceSource(project.id, { kind: "text_span", documentId: firstDocument.id, sceneId: firstScene.sceneId, sceneRevisionId: firstScene.id, anchorStart: "0", anchorEnd: "2", quotedText: "林默", modelRunId, requestId: "provenance-evidence" });
    const payload = { subjectEntityId: character.id, predicate: "appearance.face", value: "冷峻", valueType: "string", scope: "base", sceneId: null, validFromSceneId: null, validToSceneId: null };
    const patchId = randomUUID();
    database.prepare("INSERT INTO pending_patches (id, project_id, operation, target_entity_id, target_fact_id, base_version, payload_json, input_fingerprint, truth_class, confidence, conflict_kind, conflicting_fact_ids_json, conflict_message, source_revision_id, inference_id, model_run_id, status, proposed_by, version, created_at, resolved_at, resolved_by_user_id) VALUES (:id, :projectId, 'add_fact', :targetEntityId, NULL, 1, :payloadJson, :fingerprint, 'canon', 1, 'none', '[]', NULL, :sourceRevisionId, NULL, :modelRunId, 'pending', 'import', 1, :createdAt, NULL, NULL)").run({ id: patchId, projectId: project.id, targetEntityId: character.id, payloadJson: JSON.stringify(payload), fingerprint: randomUUID(), sourceRevisionId: firstScene.id, modelRunId, createdAt });
    database.prepare("INSERT INTO patch_evidence (project_id, patch_id, evidence_source_id, created_at) VALUES (:projectId, :patchId, :evidenceSourceId, :createdAt)").run({ projectId: project.id, patchId, evidenceSourceId: evidence.id, createdAt });
    const fact = createFact(project.id, { subjectEntityId: character.id, predicate: "appearance.face", value: "冷峻", valueType: "string", scope: "base", sourceId: evidence.id, requestId: "provenance-fact" });
    const requestId = "provenance-accept";
    database.prepare("INSERT INTO patch_applications (id, project_id, patch_id, operation, resulting_fact_id, applied_payload_json, request_id, created_at) VALUES (:id, :projectId, :patchId, 'add_fact', :resultingFactId, :appliedPayloadJson, :requestId, :createdAt)").run({ id: randomUUID(), projectId: project.id, patchId, resultingFactId: fact.id, appliedPayloadJson: JSON.stringify(payload), requestId, createdAt });
    for (const eventType of ["patch.accepted", "story_bible.changed"]) {
      database.prepare("INSERT INTO audit_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, actor_id, request_id, created_at) VALUES (:id, :projectId, :eventType, :aggregateType, :aggregateId, 2, '{}', 'provenance-test', :requestId, :createdAt)").run({ id: randomUUID(), projectId: project.id, eventType, aggregateType: eventType === "patch.accepted" ? "pending_patch" : "story_bible", aggregateId: patchId, requestId, createdAt });
      database.prepare("INSERT INTO outbox_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, request_id, status, attempts, available_at, published_at, created_at) VALUES (:id, :projectId, :eventType, :aggregateType, :aggregateId, 2, '{}', :requestId, 'pending', 0, :availableAt, NULL, :createdAt)").run({ id: randomUUID(), projectId: project.id, eventType, aggregateType: eventType === "patch.accepted" ? "pending_patch" : "story_bible", aggregateId: patchId, requestId, availableAt: createdAt, createdAt });
    }
    expect(() => database.prepare("UPDATE pending_patches SET status = 'accepted', version = version + 1 WHERE id = :patchId AND status = 'pending' AND version = 1").run({ patchId })).toThrow();
    expect(getPatch(patchId, project.id)?.status).toBe("pending");

    database.prepare("UPDATE model_runs SET status = 'succeeded', completed_at = :completedAt WHERE id = :modelRunId AND project_id = :projectId").run({ modelRunId, projectId: project.id, completedAt: new Date().toISOString() });
    const staleEvidence = createEvidenceSource(project.id, { kind: "text_span", documentId: secondDocument.id, sceneId: secondScene.sceneId, sceneRevisionId: secondScene.id, anchorStart: "0", anchorEnd: "2", quotedText: "另一", modelRunId, requestId: "provenance-stale-evidence" });
    database.prepare("INSERT INTO patch_evidence (project_id, patch_id, evidence_source_id, created_at) VALUES (:projectId, :patchId, :evidenceSourceId, :createdAt)").run({ projectId: project.id, patchId, evidenceSourceId: staleEvidence.id, createdAt: new Date().toISOString() });
    expect(() => database.prepare("UPDATE pending_patches SET status = 'accepted', version = version + 1 WHERE id = :patchId AND status = 'pending' AND version = 1").run({ patchId })).toThrow();
    expect(getPatch(patchId, project.id)?.status).toBe("pending");

    const nullRunPayload = { subjectEntityId: character.id, predicate: "appearance.hair", value: "black", valueType: "string", scope: "base", sceneId: null, validFromSceneId: null, validToSceneId: null };
    const nullRunPatchId = randomUUID();
    const nullRunCreatedAt = new Date().toISOString();
    database.prepare("INSERT INTO pending_patches (id, project_id, operation, target_entity_id, target_fact_id, base_version, payload_json, input_fingerprint, truth_class, confidence, conflict_kind, conflicting_fact_ids_json, conflict_message, source_revision_id, inference_id, model_run_id, status, proposed_by, version, created_at, resolved_at, resolved_by_user_id) VALUES (:id, :projectId, 'add_fact', :targetEntityId, NULL, 1, :payloadJson, :fingerprint, 'canon', 1, 'none', '[]', NULL, :sourceRevisionId, NULL, NULL, 'pending', 'import', 1, :createdAt, NULL, NULL)").run({ id: nullRunPatchId, projectId: project.id, targetEntityId: character.id, payloadJson: JSON.stringify(nullRunPayload), fingerprint: randomUUID(), sourceRevisionId: firstScene.id, createdAt: nullRunCreatedAt });
    database.prepare("INSERT INTO patch_evidence (project_id, patch_id, evidence_source_id, created_at) VALUES (:projectId, :patchId, :evidenceSourceId, :createdAt)").run({ projectId: project.id, patchId: nullRunPatchId, evidenceSourceId: evidence.id, createdAt: nullRunCreatedAt });
    const nullRunFact = createFact(project.id, { subjectEntityId: character.id, predicate: "appearance.hair", value: "black", valueType: "string", scope: "base", sourceId: evidence.id, requestId: "null-run-fact" });
    const nullRunRequestId = "null-run-accept";
    database.prepare("INSERT INTO patch_applications (id, project_id, patch_id, operation, resulting_fact_id, applied_payload_json, request_id, created_at) VALUES (:id, :projectId, :patchId, 'add_fact', :resultingFactId, :appliedPayloadJson, :requestId, :createdAt)").run({ id: randomUUID(), projectId: project.id, patchId: nullRunPatchId, resultingFactId: nullRunFact.id, appliedPayloadJson: JSON.stringify(nullRunPayload), requestId: nullRunRequestId, createdAt: nullRunCreatedAt });
    for (const eventType of ["patch.accepted", "story_bible.changed"]) {
      const aggregateType = eventType === "patch.accepted" ? "pending_patch" : "story_bible";
      database.prepare("INSERT INTO audit_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, actor_id, request_id, created_at) VALUES (:id, :projectId, :eventType, :aggregateType, :aggregateId, 2, '{}', 'provenance-test', :requestId, :createdAt)").run({ id: randomUUID(), projectId: project.id, eventType, aggregateType, aggregateId: nullRunPatchId, requestId: nullRunRequestId, createdAt: nullRunCreatedAt });
      database.prepare("INSERT INTO outbox_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, request_id, status, attempts, available_at, published_at, created_at) VALUES (:id, :projectId, :eventType, :aggregateType, :aggregateId, 2, '{}', :requestId, 'pending', 0, :availableAt, NULL, :createdAt)").run({ id: randomUUID(), projectId: project.id, eventType, aggregateType, aggregateId: nullRunPatchId, requestId: nullRunRequestId, availableAt: nullRunCreatedAt, createdAt: nullRunCreatedAt });
    }
    expect(() => database.prepare("UPDATE pending_patches SET status = 'accepted', version = version + 1 WHERE id = :patchId AND status = 'pending' AND version = 1").run({ patchId: nullRunPatchId })).toThrow();
    expect(getPatch(nullRunPatchId, project.id)?.status).toBe("pending");
  });

  it("reapplies all v11/v12 guards when a v10 database is upgraded", () => {
    const project = createProject({ title: "Migration" });
    const foreign = createProject({ title: "Foreign" });
    const character = createEntity(project.id, { type: "character", canonicalName: "林默" });
    const foreignLocation = createEntity(foreign.id, { type: "location", canonicalName: "酒吧" });
    const document = createDocument(project.id, { title: "Script", requestId: "migration-document", scenes: [{ title: "One", content: "林默。" }] });
    const scene = getDocumentRevision(document.currentRevisionId as string, project.id)?.sceneRevisions[0];
    if (!scene) throw new Error("scene missing");
    const proposal = proposeFactPatch(project.id, { documentId: document.id, sceneId: scene.sceneId, sceneRevisionId: scene.id, operation: "add_fact", subjectEntityId: character.id, predicate: "appearance.face", value: "冷峻", valueType: "string", scope: "base", evidence: [{ anchorStart: 0, anchorEnd: 2, quotedText: "林默" }], requestId: "migration-proposal" });
    const modelRunId = proposal.modelRun?.id;
    if (!modelRunId) throw new Error("model run missing");
    const database = getDatabase();
    database.exec("DROP TRIGGER IF EXISTS facts_scope_shape_guard; DROP TRIGGER IF EXISTS inferences_scope_shape_guard; DROP TRIGGER IF EXISTS inferences_entity_ref_project_guard; DROP TRIGGER IF EXISTS pending_patches_accepted_fact_provenance_guard; PRAGMA user_version = 10;");
    bootstrapDatabase(database);
    expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(() => database.prepare("INSERT INTO facts (id, project_id, subject_entity_id, predicate, value_json, value_type, truth_class, scope, scene_id, valid_from_scene_id, source_id, status, version, created_at) VALUES (:id, :projectId, :subjectEntityId, 'appearance.face', 'null', 'string', 'canon', 'scene', :sceneId, :validFromSceneId, :sourceId, 'active', 1, :createdAt)").run({ id: randomUUID(), projectId: project.id, subjectEntityId: character.id, sceneId: scene.sceneId, validFromSceneId: scene.sceneId, sourceId: proposal.patch.evidenceSourceIds[0], createdAt: new Date().toISOString() })).toThrow();
    expect(() => database.prepare("INSERT INTO inferences (id, project_id, subject_entity_id, predicate, value_json, value_type, scope, confidence, model_run_id, status, version, created_at) VALUES (:id, :projectId, :subjectEntityId, 'state.location', :valueJson, 'entity_ref', 'base', 0.5, :modelRunId, 'active', 1, :createdAt)").run({ id: randomUUID(), projectId: project.id, subjectEntityId: character.id, valueJson: JSON.stringify(foreignLocation.id), modelRunId, createdAt: new Date().toISOString() })).toThrow();
    const forgedFact = createFact(project.id, { subjectEntityId: character.id, predicate: "appearance.face", value: "伪造", valueType: "string", scope: "base", sourceId: proposal.patch.evidenceSourceIds[0], requestId: "migration-forged-fact" });
    const requestId = "migration-forged-accept";
    database.prepare("INSERT INTO patch_applications (id, project_id, patch_id, operation, resulting_fact_id, applied_payload_json, request_id, created_at) VALUES (:id, :projectId, :patchId, 'add_fact', :resultingFactId, :appliedPayloadJson, :requestId, :createdAt)").run({ id: randomUUID(), projectId: project.id, patchId: proposal.patch.id, resultingFactId: forgedFact.id, appliedPayloadJson: JSON.stringify(proposal.patch.payload), requestId, createdAt: new Date().toISOString() });
    for (const eventType of ["patch.accepted", "story_bible.changed"]) {
      database.prepare("INSERT INTO audit_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, actor_id, request_id, created_at) VALUES (:id, :projectId, :eventType, 'pending_patch', :aggregateId, 2, '{}', 'migration-test', :requestId, :createdAt)").run({ id: randomUUID(), projectId: project.id, eventType, aggregateId: proposal.patch.id, requestId, createdAt: new Date().toISOString() });
      database.prepare("INSERT INTO outbox_events (id, project_id, event_type, aggregate_type, aggregate_id, payload_json, request_id, status, attempts, available_at, created_at) VALUES (:id, :projectId, :eventType, 'pending_patch', :aggregateId, '{}', :requestId, 'pending', 0, :availableAt, :createdAt)").run({ id: randomUUID(), projectId: project.id, eventType, aggregateId: proposal.patch.id, requestId, availableAt: new Date().toISOString(), createdAt: new Date().toISOString() });
    }
    expect(() => database.prepare("UPDATE pending_patches SET status = 'accepted', version = version + 1 WHERE id = :id AND status = 'pending' AND version = 1").run({ id: proposal.patch.id })).toThrow();
    expect(getPatch(proposal.patch.id, project.id)?.status).toBe("pending");
  });
});
