import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  acceptEditedPatchInputSchema,
  acceptPatchInputSchema,
  evidenceAnchorSchema,
  factPatchPayloadSchema,
  patchApplicationSchema,
  pendingPatchSchema,
  proposeFactPatchInputSchema,
  rejectPatchInputSchema,
  retractFactPatchPayloadSchema,
  type AcceptEditedPatchInput,
  type AcceptPatchInput,
  type FactPatchPayload,
  type Patch,
  type PatchApplication,
  type ProposeFactPatchInput,
  type RejectPatchInput,
} from "@/domain/canon-patch";
import {
  proposeStatePatchInputSchema,
  statePatchPayloadSchema,
  type ProposeStatePatchInput,
  type ParsedProposeStatePatchInput,
  type StatePatchPayload,
} from "@/domain/scene-state";
import { inferenceSchema, modelRunSchema, type Inference, type ModelRun } from "@/domain/inference";
import {
  factSchema,
  getPredicateDefinition,
  entityStateSchema,
  isSceneStatePredicate,
  type EntityState,
  validatePredicateValue,
  type Fact,
} from "@/domain/story-bible";
import { getDatabase } from "./connection";
import {
  SceneAnalysisStaleError,
  StoryBibleConflictError,
  StoryBibleDataIntegrityError,
  StoryBibleIdempotencyConflictError,
  StoryBibleNotFoundError,
  StoryBiblePatchConflictError,
  StoryBiblePatchResolvedError,
  StoryBibleValidationError,
} from "./story-bible-errors";
import { factScopeInterval, factScopesOverlap, getEntityForProject } from "./story-bible";

type SqliteParameters = Record<string, string | number | null>;

type SourceRevision = {
  id: string;
  project_id: string;
  document_id: string;
  scene_id: string;
  content_hash: string;
  content: string;
  status: "active" | "deleted";
};

type ModelRunRow = {
  id: string;
  project_id: string;
  kind: ModelRun["kind"];
  model: string;
  model_version: string;
  source_revision_id: string;
  input_hash: string;
  status: ModelRun["status"];
  output_hash: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
};

type InferenceRow = {
  id: string;
  project_id: string;
  subject_entity_id: string;
  predicate: string;
  value_json: string;
  value_type: Inference["valueType"];
  scope: Inference["scope"];
  scene_id: string | null;
  valid_from_scene_id: string | null;
  valid_to_scene_id: string | null;
  confidence: number;
  rationale: string | null;
  model_run_id: string;
  status: Inference["status"];
  version: number;
  created_at: string;
};

type PatchRow = {
  id: string;
  project_id: string;
  operation: Patch["operation"];
  target_entity_id: string | null;
  target_fact_id: string | null;
  base_version: number | null;
  payload_json: string;
  input_fingerprint: string;
  truth_class: Patch["truthClass"];
  confidence: number | null;
  conflict_kind: Patch["conflictKind"];
  conflicting_fact_ids_json: string;
  conflicting_state_ids_json: string;
  conflict_message: string | null;
  source_revision_id: string;
  inference_id: string | null;
  model_run_id: string | null;
  status: Patch["status"];
  proposed_by: Patch["proposedBy"];
  version: number;
  created_at: string;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
};

type FactRow = {
  id: string;
  project_id: string;
  subject_entity_id: string;
  predicate: string;
  value_json: string;
  value_type: Fact["valueType"];
  truth_class: "canon";
  scope: Fact["scope"];
  scene_id: string | null;
  valid_from_scene_id: string | null;
  valid_to_scene_id: string | null;
  source_id: string;
  promoted_from_inference_id: string | null;
  status: Fact["status"];
  supersedes_fact_id: string | null;
  version: number;
  created_at: string;
};

type EntityStateRow = {
  id: string;
  project_id: string;
  entity_id: string;
  predicate: EntityState["predicate"];
  value_json: string;
  value_type: EntityState["valueType"];
  applies_at_scene_id: string;
  source_revision_id: string;
  continuity_group_id: string;
  carry_forward: number;
  priority: number;
  valid_to_scene_id: string | null;
  source_id: string;
  truth_class: "canon";
  status: EntityState["status"];
  version: number;
  created_at: string;
};

type ConflictResult = {
  kind: Patch["conflictKind"];
  ids: string[];
  message: string | null;
};

type PreparedProposal = {
  payload: FactPatchPayload | StatePatchPayload | Record<string, never>;
  targetEntityId: string | null;
  targetFactId: string | null;
  baseVersion: number | null;
};

function resolveDatabase(database?: DatabaseSync) {
  return database ?? getDatabase();
}

function now() {
  return new Date().toISOString();
}

function withTransaction<T>(database: DatabaseSync, operation: () => T) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  }
}

function parseJson(value: string, message: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new StoryBibleDataIntegrityError(message);
  }
}

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function proposalRequestFingerprint(values: ProposeFactPatchInput) {
  return hashJson({
    documentId: values.documentId,
    sceneId: values.sceneId,
    sceneRevisionId: values.sceneRevisionId,
    operation: values.operation,
    subjectEntityId: values.subjectEntityId ?? null,
    predicate: values.predicate ?? null,
    value: values.value,
    valueType: values.valueType ?? null,
    scope: values.scope ?? null,
    factSceneId: values.factSceneId ?? null,
    validFromSceneId: values.validFromSceneId ?? null,
    validToSceneId: values.validToSceneId ?? null,
    targetEntityId: values.targetEntityId ?? null,
    targetFactId: values.targetFactId ?? null,
    baseVersion: values.baseVersion ?? null,
    evidence: values.evidence.map((anchor) => ({ anchorStart: anchor.anchorStart, anchorEnd: anchor.anchorEnd, quotedText: anchor.quotedText ?? null })),
    confidence: values.confidence,
    rationale: values.rationale,
    model: values.model,
    modelVersion: values.modelVersion,
    proposedBy: values.proposedBy,
    actorId: values.actorId,
  });
}

function proposalSemanticFingerprint(values: { sourceRevisionId: string; operation: Patch["operation"]; targetEntityId: string | null; targetFactId: string | null; baseVersion: number | null; payload: unknown; evidence: Array<{ anchorStart: number; anchorEnd: number }> }) {
  return hashJson({ sourceRevisionId: values.sourceRevisionId, operation: values.operation, targetEntityId: values.targetEntityId, targetFactId: values.targetFactId, baseVersion: values.baseVersion, payload: values.payload, evidence: values.evidence.map((anchor) => ({ anchorStart: anchor.anchorStart, anchorEnd: anchor.anchorEnd })) });
}

function getProject(database: DatabaseSync, projectId: string) {
  const row = database.prepare("SELECT id FROM projects WHERE id = :projectId").get({ projectId }) as { id?: string } | undefined;
  if (!row) throw new StoryBibleNotFoundError("Project not found");
}

function writeEvent(database: DatabaseSync, values: { projectId: string; eventType: string; aggregateType: string; aggregateId: string; aggregateVersion?: number | null; requestId: string; actorId?: string; payload?: Record<string, unknown> }) {
  const createdAt = now();
  const payloadJson = JSON.stringify(values.payload ?? {});
  database.prepare("INSERT OR IGNORE INTO audit_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, actor_id, request_id, created_at) VALUES (:id, :projectId, :eventType, :aggregateType, :aggregateId, :aggregateVersion, :payloadJson, :actorId, :requestId, :createdAt)").run({ id: randomUUID(), projectId: values.projectId, eventType: values.eventType, aggregateType: values.aggregateType, aggregateId: values.aggregateId, aggregateVersion: values.aggregateVersion ?? null, payloadJson, actorId: values.actorId ?? "local-user", requestId: values.requestId, createdAt });
  database.prepare("INSERT OR IGNORE INTO outbox_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, request_id, status, attempts, available_at, published_at, created_at) VALUES (:id, :projectId, :eventType, :aggregateType, :aggregateId, :aggregateVersion, :payloadJson, :requestId, 'pending', 0, :availableAt, NULL, :createdAt)").run({ id: randomUUID(), projectId: values.projectId, eventType: values.eventType, aggregateType: values.aggregateType, aggregateId: values.aggregateId, aggregateVersion: values.aggregateVersion ?? null, payloadJson, requestId: values.requestId, availableAt: createdAt, createdAt });
}

function getIdempotency(database: DatabaseSync, projectId: string, operation: string, requestId: string) {
  const row = database.prepare("SELECT resource_id, response_json FROM idempotency_keys WHERE project_id = :projectId AND operation = :operation AND request_id = :requestId").get({ projectId, operation, requestId }) as { resource_id?: string; response_json?: string } | undefined;
  if (!row) return null;
  if (!row.resource_id || !row.response_json) throw new StoryBibleDataIntegrityError("Stored patch idempotency mapping is incomplete");
  return { resourceId: row.resource_id, response: parseJson(row.response_json, "Stored patch idempotency response is invalid") as Record<string, unknown> };
}

function storeIdempotency(database: DatabaseSync, values: { projectId: string; operation: string; requestId: string; resourceType: string; resourceId: string; response: Record<string, unknown> }) {
  database.prepare("INSERT INTO idempotency_keys (id, project_id, operation, request_id, resource_type, resource_id, response_json, created_at) VALUES (:id, :projectId, :operation, :requestId, :resourceType, :resourceId, :responseJson, :createdAt)").run({ id: randomUUID(), projectId: values.projectId, operation: values.operation, requestId: values.requestId, resourceType: values.resourceType, resourceId: values.resourceId, responseJson: JSON.stringify(values.response), createdAt: now() });
}

function toModelRun(row: ModelRunRow): ModelRun {
  return modelRunSchema.parse({ id: row.id, projectId: row.project_id, kind: row.kind, model: row.model, modelVersion: row.model_version, sourceRevisionId: row.source_revision_id, inputHash: row.input_hash, status: row.status, outputHash: row.output_hash, errorCode: row.error_code, errorMessage: row.error_message, createdAt: row.created_at, completedAt: row.completed_at });
}

function selectModelRun(database: DatabaseSync, runId: string, projectId: string) {
  const row = database.prepare("SELECT id, project_id, kind, model, model_version, source_revision_id, input_hash, status, output_hash, error_code, error_message, created_at, completed_at FROM model_runs WHERE id = :runId AND project_id = :projectId").get({ runId, projectId }) as unknown as ModelRunRow | undefined;
  return row ? toModelRun(row) : null;
}

function toInference(database: DatabaseSync, row: InferenceRow): Inference {
  const evidenceSourceIds = (database.prepare("SELECT evidence_source_id FROM inference_evidence WHERE project_id = :projectId AND inference_id = :inferenceId ORDER BY evidence_source_id").all({ projectId: row.project_id, inferenceId: row.id }) as Array<{ evidence_source_id: string }>).map((item) => item.evidence_source_id);
  return inferenceSchema.parse({ id: row.id, projectId: row.project_id, subjectEntityId: row.subject_entity_id, predicate: row.predicate, value: parseJson(row.value_json, `Invalid inference value ${row.id}`), valueType: row.value_type, scope: row.scope, sceneId: row.scene_id, validFromSceneId: row.valid_from_scene_id, validToSceneId: row.valid_to_scene_id, confidence: row.confidence, rationale: row.rationale, modelRunId: row.model_run_id, status: row.status, version: row.version, createdAt: row.created_at, evidenceSourceIds });
}

function selectInference(database: DatabaseSync, inferenceId: string, projectId: string) {
  const row = database.prepare("SELECT id, project_id, subject_entity_id, predicate, value_json, value_type, scope, scene_id, valid_from_scene_id, valid_to_scene_id, confidence, rationale, model_run_id, status, version, created_at FROM inferences WHERE id = :inferenceId AND project_id = :projectId").get({ inferenceId, projectId }) as unknown as InferenceRow | undefined;
  return row ? toInference(database, row) : null;
}

function toFact(row: FactRow): Fact {
  return factSchema.parse({ id: row.id, projectId: row.project_id, subjectEntityId: row.subject_entity_id, predicate: row.predicate, value: parseJson(row.value_json, `Invalid fact value ${row.id}`), valueType: row.value_type, truthClass: row.truth_class, scope: row.scope, sceneId: row.scene_id, validFromSceneId: row.valid_from_scene_id, validToSceneId: row.valid_to_scene_id, sourceId: row.source_id, promotedFromInferenceId: row.promoted_from_inference_id, status: row.status, supersedesFactId: row.supersedes_fact_id, version: row.version, createdAt: row.created_at });
}

function selectFact(database: DatabaseSync, factId: string, projectId: string) {
  const row = database.prepare("SELECT id, project_id, subject_entity_id, predicate, value_json, value_type, truth_class, scope, scene_id, valid_from_scene_id, valid_to_scene_id, source_id, promoted_from_inference_id, status, supersedes_fact_id, version, created_at FROM facts WHERE id = :factId AND project_id = :projectId").get({ factId, projectId }) as unknown as FactRow | undefined;
  return row ? toFact(row) : null;
}

function toEntityState(row: EntityStateRow): EntityState {
  return entityStateSchema.parse({
    id: row.id,
    projectId: row.project_id,
    entityId: row.entity_id,
    predicate: row.predicate,
    value: parseJson(row.value_json, `Invalid entity state value ${row.id}`),
    valueType: row.value_type,
    appliesAtSceneId: row.applies_at_scene_id,
    sourceRevisionId: row.source_revision_id,
    continuityGroupId: row.continuity_group_id,
    carryForward: row.carry_forward === 1,
    priority: row.priority,
    validToSceneId: row.valid_to_scene_id,
    sourceId: row.source_id,
    truthClass: row.truth_class,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
  });
}

function selectEntityState(database: DatabaseSync, stateId: string, projectId: string) {
  const row = database.prepare("SELECT id, project_id, entity_id, predicate, value_json, value_type, applies_at_scene_id, source_revision_id, continuity_group_id, carry_forward, priority, valid_to_scene_id, source_id, truth_class, status, version, created_at FROM entity_states WHERE id = :stateId AND project_id = :projectId").get({ stateId, projectId }) as unknown as EntityStateRow | undefined;
  return row ? toEntityState(row) : null;
}

function patchEvidenceIds(database: DatabaseSync, projectId: string, patchId: string) {
  return (database.prepare("SELECT evidence_source_id FROM patch_evidence WHERE project_id = :projectId AND patch_id = :patchId ORDER BY evidence_source_id").all({ projectId, patchId }) as Array<{ evidence_source_id: string }>).map((item) => item.evidence_source_id);
}

function selectApplication(database: DatabaseSync, projectId: string, patchId: string, requestId?: string) {
  const row = database.prepare(`SELECT id, project_id, patch_id, operation, resulting_fact_id, resulting_state_id, applied_payload_json, request_id, created_at FROM patch_applications WHERE project_id = :projectId AND patch_id = :patchId${requestId ? " AND request_id = :requestId" : ""} ORDER BY created_at DESC, id DESC LIMIT 1`).get(requestId ? { projectId, patchId, requestId } : { projectId, patchId }) as { id?: string; project_id?: string; patch_id?: string; operation?: Patch["operation"]; resulting_fact_id?: string | null; resulting_state_id?: string | null; applied_payload_json?: string; request_id?: string; created_at?: string } | undefined;
  if (!row?.id || !row.project_id || !row.patch_id || !row.operation || !row.request_id || !row.created_at) return null;
  const appliedPayload = parseJson(row.applied_payload_json ?? "{}", `Invalid patch application payload ${row.id}`);
  if (appliedPayload === null || typeof appliedPayload !== "object" || Array.isArray(appliedPayload)) throw new StoryBibleDataIntegrityError(`Invalid patch application payload ${row.id}`);
  return patchApplicationSchema.parse({ id: row.id, projectId: row.project_id, patchId: row.patch_id, operation: row.operation, resultingFactId: row.resulting_fact_id ?? null, resultingStateId: row.resulting_state_id ?? null, appliedPayload: appliedPayload as Record<string, unknown>, requestId: row.request_id, createdAt: row.created_at });
}

function applicationFromRow(row: { id?: string; project_id?: string; patch_id?: string; operation?: Patch["operation"]; resulting_fact_id?: string | null; resulting_state_id?: string | null; applied_payload_json?: string; request_id?: string; created_at?: string }) {
  if (!row.id || !row.project_id || !row.patch_id || !row.operation || !row.request_id || !row.created_at) return null;
  const appliedPayload = parseJson(row.applied_payload_json ?? "{}", `Invalid patch application payload ${row.id}`);
  if (appliedPayload === null || typeof appliedPayload !== "object" || Array.isArray(appliedPayload)) throw new StoryBibleDataIntegrityError(`Invalid patch application payload ${row.id}`);
  return patchApplicationSchema.parse({ id: row.id, projectId: row.project_id, patchId: row.patch_id, operation: row.operation, resultingFactId: row.resulting_fact_id ?? null, resultingStateId: row.resulting_state_id ?? null, appliedPayload: appliedPayload as Record<string, unknown>, requestId: row.request_id, createdAt: row.created_at });
}

function toPatch(database: DatabaseSync, row: PatchRow): Patch {
  if (row.truth_class !== "canon") {
    throw new StoryBibleDataIntegrityError(`Pending Patch ${row.id} has a non-Canon truth class`);
  }
  if ((row.operation === "add_fact" && (!row.target_entity_id || row.target_fact_id !== null || row.base_version === null))
    || (row.operation === "replace_fact" && (!row.target_entity_id || !row.target_fact_id || row.base_version === null))
    || (row.operation === "retract_fact" && (!row.target_fact_id || row.base_version === null))
    || (row.operation === "add_state" && (!row.target_entity_id || row.target_fact_id !== null || row.base_version === null))) {
    throw new StoryBibleDataIntegrityError(`Pending Patch ${row.id} has an invalid command shape`);
  }
  const conflictingFactIds = parseJson(row.conflicting_fact_ids_json, `Invalid patch conflict payload ${row.id}`);
  if (!Array.isArray(conflictingFactIds) || !conflictingFactIds.every((value) => typeof value === "string")) throw new StoryBibleDataIntegrityError(`Invalid patch conflict payload ${row.id}`);
  const conflictingStateIds = parseJson(row.conflicting_state_ids_json ?? "[]", `Invalid patch state conflict payload ${row.id}`);
  if (!Array.isArray(conflictingStateIds) || !conflictingStateIds.every((value) => typeof value === "string")) throw new StoryBibleDataIntegrityError(`Invalid patch state conflict payload ${row.id}`);
  const payload = parseJson(row.payload_json, `Invalid patch payload ${row.id}`);
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw new StoryBibleDataIntegrityError(`Invalid patch payload ${row.id}`);
  return pendingPatchSchema.parse({ id: row.id, projectId: row.project_id, operation: row.operation, targetEntityId: row.target_entity_id, targetFactId: row.target_fact_id, baseVersion: row.base_version, payload: payload as Record<string, unknown>, truthClass: row.truth_class, evidenceSourceIds: patchEvidenceIds(database, row.project_id, row.id), confidence: row.confidence, conflictKind: row.conflict_kind, conflictingFactIds, conflictingStateIds, conflictMessage: row.conflict_message, sourceRevisionId: row.source_revision_id, inferenceId: row.inference_id, modelRunId: row.model_run_id, status: row.status, proposedBy: row.proposed_by, version: row.version, createdAt: row.created_at, resolvedAt: row.resolved_at, resolvedByUserId: row.resolved_by_user_id });
}

function selectPatch(database: DatabaseSync, patchId: string, projectId: string) {
  const row = database.prepare("SELECT id, project_id, operation, target_entity_id, target_fact_id, base_version, payload_json, input_fingerprint, truth_class, confidence, conflict_kind, conflicting_fact_ids_json, conflicting_state_ids_json, conflict_message, source_revision_id, inference_id, model_run_id, status, proposed_by, version, created_at, resolved_at, resolved_by_user_id FROM pending_patches WHERE id = :patchId AND project_id = :projectId").get({ patchId, projectId }) as unknown as PatchRow | undefined;
  return row ? toPatch(database, row) : null;
}

function currentSourceRevision(database: DatabaseSync, values: { projectId: string; documentId: string; sceneId: string; sceneRevisionId: string }, allowDeleted = false) {
  const row = database.prepare("SELECT sr.id, sr.project_id, sr.document_id, sr.scene_id, sr.content_hash, sr.content, sr.status FROM script_documents d JOIN scene_revisions sr ON sr.document_revision_id = d.current_revision_id AND sr.scene_id = :sceneId WHERE d.id = :documentId AND d.project_id = :projectId").get({ projectId: values.projectId, documentId: values.documentId, sceneId: values.sceneId }) as unknown as SourceRevision | undefined;
  if (!row || row.id !== values.sceneRevisionId) throw new SceneAnalysisStaleError("The source scene revision is no longer current");
  if (row.status === "deleted" && !allowDeleted) throw new SceneAnalysisStaleError("The source scene revision has been deleted");
  return row;
}

type ScenePositionRow = {
  id: string;
  project_id: string;
  document_id: string;
  narrative_rank: number;
};

function getScenePosition(database: DatabaseSync, projectId: string, sceneId: string, path: Array<string | number>, sourceDocumentId?: string) {
  const row = database.prepare("SELECT id, project_id, document_id, narrative_rank FROM scenes WHERE id = :sceneId").get({ sceneId }) as unknown as ScenePositionRow | undefined;
  if (!row || row.project_id !== projectId) throw new StoryBibleValidationError("Scene reference must belong to the same project", path);
  if (sourceDocumentId !== undefined && row.document_id !== sourceDocumentId) throw new StoryBibleValidationError("Scene reference must belong to the source document", path);
  if (!Number.isInteger(row.narrative_rank) || row.narrative_rank < 0) throw new StoryBibleValidationError("Scene narrative rank is invalid", path);
  return row;
}

function validatePayloadScope(database: DatabaseSync, projectId: string, payload: FactPatchPayload, source: SourceRevision) {
  if (payload.scope === "base") {
    if (payload.sceneId !== null || payload.validFromSceneId !== null || payload.validToSceneId !== null) throw new StoryBibleValidationError("Base facts cannot reference a scene", ["payload", "scope"]);
    return;
  }
  if (payload.scope === "scene") {
    if (payload.sceneId !== source.scene_id) throw new StoryBibleValidationError("Scene fact must belong to the source scene", ["payload", "sceneId"]);
    if (payload.validFromSceneId !== null || payload.validToSceneId !== null) throw new StoryBibleValidationError("Scene facts cannot carry range bounds", ["payload", "scope"]);
    getScenePosition(database, projectId, payload.sceneId, ["payload", "sceneId"], source.document_id);
    return;
  }
  if (payload.sceneId !== null) throw new StoryBibleValidationError("Range facts cannot carry sceneId", ["payload", "sceneId"]);
  if (payload.validFromSceneId === null) throw new StoryBibleValidationError("Range facts require validFromSceneId", ["payload", "validFromSceneId"]);
  const from = getScenePosition(database, projectId, payload.validFromSceneId, ["payload", "validFromSceneId"], source.document_id);
  if (payload.validToSceneId !== null) {
    const to = getScenePosition(database, projectId, payload.validToSceneId, ["payload", "validToSceneId"], source.document_id);
    if (to.narrative_rank < from.narrative_rank) throw new StoryBibleValidationError("Range validToSceneId must not precede validFromSceneId", ["payload", "validToSceneId"]);
  }
}

function validatePayload(database: DatabaseSync, projectId: string, operation: Patch["operation"], payload: unknown, source: SourceRevision, targetFactId: string | null) {
  if (operation === "retract_fact") {
    retractFactPatchPayloadSchema.parse(payload);
    return {} as Record<string, never>;
  }
  const normalized = factPatchPayloadSchema.parse(payload);
  const entity = getEntityForProject(projectId, normalized.subjectEntityId, database);
  const validation = validatePredicateValue({ predicate: normalized.predicate, value: normalized.value, valueType: normalized.valueType, scope: normalized.scope, entityType: entity.type });
  if (!validation.ok) throw new StoryBibleValidationError(validation.message, ["payload"]);
  if (normalized.valueType === "entity_ref") {
    const referencedId = typeof normalized.value === "string" ? normalized.value : "";
    let referenced = null as ReturnType<typeof getEntityForProject> | null;
    try {
      referenced = referencedId ? getEntityForProject(projectId, referencedId, database) : null;
    } catch (error) {
      if (error instanceof StoryBibleNotFoundError) throw new StoryBibleValidationError("Entity reference must point to an entity in the same project", ["payload", "value"]);
      throw error;
    }
    if (!referenced || referenced.status === "archived" || referenced.status === "merged" || referenced.mergedIntoEntityId !== null) throw new StoryBibleValidationError("Entity reference must point to an active entity in the same project", ["payload", "value"]);
  }
  const definition = getPredicateDefinition(normalized.predicate);
  if (!definition) throw new StoryBibleValidationError("Unknown predicate", ["payload", "predicate"]);
  if (normalized.scope !== "base" && !normalized.sceneId && !normalized.validFromSceneId) throw new StoryBibleValidationError("Scene and range facts require a scene reference", ["payload", "sceneId"]);
  validatePayloadScope(database, projectId, normalized, source);
  if (targetFactId) {
    const target = selectFact(database, targetFactId, projectId);
    if (!target) throw new StoryBibleNotFoundError("Target fact not found");
    if (target.status !== "active") throw new StoryBibleValidationError("Only an active fact can be replaced", ["targetFactId"]);
    if (target.subjectEntityId !== normalized.subjectEntityId || target.predicate !== normalized.predicate || target.valueType !== normalized.valueType || target.scope !== normalized.scope || target.sceneId !== normalized.sceneId || target.validFromSceneId !== normalized.validFromSceneId || target.validToSceneId !== normalized.validToSceneId) throw new StoryBibleValidationError("Replacement must preserve the target fact identity, value type, scope, and scene bounds", ["payload"]);
  }
  return normalized;
}

function prepareProposal(database: DatabaseSync, projectId: string, values: ProposeFactPatchInput, source?: SourceRevision): { prepared: PreparedProposal; source: SourceRevision } {
  const actualSource = source ?? currentSourceRevision(database, { projectId, documentId: values.documentId, sceneId: values.sceneId, sceneRevisionId: values.sceneRevisionId });
  const targetFactId = values.targetFactId ?? null;
  let targetEntityId = values.targetEntityId ?? values.subjectEntityId ?? null;
  if (values.operation === "retract_fact") {
    if (!targetFactId) throw new StoryBibleValidationError("targetFactId is required for retract_fact", ["targetFactId"]);
    const target = selectFact(database, targetFactId, projectId);
    if (!target) throw new StoryBibleNotFoundError("Target fact not found");
    if (target.status !== "active") throw new StoryBibleValidationError("Only an active fact can be retracted", ["targetFactId"]);
    targetEntityId = target.subjectEntityId;
  } else {
    if (!values.subjectEntityId || !values.predicate || values.valueType === undefined || values.scope === undefined) throw new StoryBibleValidationError("subjectEntityId, predicate, valueType, and scope are required", ["payload"]);
    const rawPayload = { subjectEntityId: values.subjectEntityId, predicate: values.predicate, value: values.value, valueType: values.valueType, scope: values.scope, sceneId: values.factSceneId ?? (values.scope === "scene" ? values.sceneId : null), validFromSceneId: values.validFromSceneId ?? (values.scope === "range" ? values.sceneId : null), validToSceneId: values.validToSceneId ?? null };
    const payload = validatePayload(database, projectId, values.operation, rawPayload, actualSource, targetFactId);
    if (targetEntityId !== payload.subjectEntityId) throw new StoryBibleValidationError("targetEntityId must match subjectEntityId", ["targetEntityId"]);
    targetEntityId = payload.subjectEntityId;
    if (values.operation === "replace_fact" && !targetFactId) throw new StoryBibleValidationError("targetFactId is required for replace_fact", ["targetFactId"]);
    const target = targetFactId ? selectFact(database, targetFactId, projectId) : null;
    const entity = getEntityForProject(projectId, targetEntityId, database);
    const baseVersion = values.baseVersion ?? target?.version ?? entity.version;
    if (target && baseVersion !== target.version) throw new StoryBibleConflictError("fact", target);
    if (!target && values.baseVersion !== undefined && baseVersion !== entity.version) throw new StoryBibleConflictError("entity", entity);
    return { prepared: { payload, targetEntityId, targetFactId, baseVersion }, source: actualSource };
  }
  const target = targetFactId ? selectFact(database, targetFactId, projectId) : null;
  const baseVersion = values.baseVersion ?? target?.version ?? null;
  if (!target || target.status !== "active") throw new StoryBibleValidationError("Only an active target fact can be retracted", ["targetFactId"]);
  if (baseVersion !== target.version) throw new StoryBibleConflictError("fact", target);
  return { prepared: { payload: {}, targetEntityId, targetFactId, baseVersion }, source: actualSource };
}

function detectConflict(database: DatabaseSync, projectId: string, payload: FactPatchPayload, targetFactId: string | null): ConflictResult {
  const definition = getPredicateDefinition(payload.predicate);
  if (!definition || definition.cardinality !== "single") return { kind: "none", ids: [], message: null };
  const candidateScope = factScopeInterval(database, projectId, payload, "proposal payload");
  const rows = database.prepare("SELECT id, value_json, scope, scene_id, valid_from_scene_id, valid_to_scene_id FROM facts WHERE project_id = :projectId AND subject_entity_id = :subjectEntityId AND predicate = :predicate AND status = 'active'").all({ projectId, subjectEntityId: payload.subjectEntityId, predicate: payload.predicate }) as Array<{ id: string; value_json: string; scope: Fact["scope"]; scene_id: string | null; valid_from_scene_id: string | null; valid_to_scene_id: string | null }>;
  const overlapping = rows.filter((row) => row.id !== targetFactId && factScopesOverlap(candidateScope, factScopeInterval(database, projectId, { scope: row.scope, sceneId: row.scene_id, validFromSceneId: row.valid_from_scene_id, validToSceneId: row.valid_to_scene_id }, `fact ${row.id}`)));
  const conflicts = overlapping.filter((row) => row.value_json !== JSON.stringify(payload.value)).map((row) => row.id);
  if (conflicts.length > 0) return { kind: "hard", ids: conflicts, message: "An active Canon fact overlaps the proposed single-value scope with a different value." };
  const duplicates = overlapping;
  if (duplicates.length > 0) return { kind: "hard", ids: duplicates.map((row) => row.id), message: "An active Canon fact already occupies this single-value scope." };
  return { kind: "none", ids: [], message: null };
}

type StateConflictResult = { kind: Patch["conflictKind"]; stateIds: string[]; factIds: string[]; message: string | null };

function detectStateConflict(database: DatabaseSync, projectId: string, payload: StatePatchPayload, source: SourceRevision, excludedStateId?: string | null): StateConflictResult {
  if (payload.predicate === "state.held_prop") return { kind: "none", stateIds: [], factIds: [], message: null };
  const stateRows = database.prepare("SELECT id, value_json, priority FROM entity_states WHERE project_id = :projectId AND entity_id = :entityId AND predicate = :predicate AND applies_at_scene_id = :sceneId AND continuity_group_id = :continuityGroupId AND status = 'active' AND id IS NOT :excludedStateId").all({ projectId, entityId: payload.subjectEntityId, predicate: payload.predicate, sceneId: payload.appliesAtSceneId, continuityGroupId: payload.continuityGroupId, excludedStateId: excludedStateId ?? null }) as Array<{ id: string; value_json: string; priority: number }>;
  const stateIds = stateRows.filter((row) => row.priority === payload.priority && row.value_json !== JSON.stringify(payload.value)).map((row) => row.id);
  const sourceScene = getScenePosition(database, projectId, source.scene_id, ["sceneId"], source.document_id);
  const factRows = database.prepare("SELECT f.id, f.value_json, f.scope, f.scene_id, f.valid_from_scene_id, f.valid_to_scene_id FROM facts f WHERE f.project_id = :projectId AND f.subject_entity_id = :entityId AND f.predicate = :predicate AND f.status = 'active'").all({ projectId, entityId: payload.subjectEntityId, predicate: payload.predicate }) as Array<{ id: string; value_json: string; scope: Fact["scope"]; scene_id: string | null; valid_from_scene_id: string | null; valid_to_scene_id: string | null }>;
  const factIds = factRows.filter((row) => {
    if (row.value_json === JSON.stringify(payload.value)) return false;
    if (row.scope === "scene") return row.scene_id === source.scene_id;
    if (row.scope !== "range" || !row.valid_from_scene_id) return false;
    try {
      const from = getScenePosition(database, projectId, row.valid_from_scene_id, ["validFromSceneId"], source.document_id);
      const to = row.valid_to_scene_id ? getScenePosition(database, projectId, row.valid_to_scene_id, ["validToSceneId"], source.document_id) : null;
      return from.narrative_rank <= sourceScene.narrative_rank && (!to || sourceScene.narrative_rank <= to.narrative_rank);
    } catch {
      return false;
    }
  }).map((row) => row.id);
  const ids = [...stateIds, ...factIds];
  return ids.length > 0 ? { kind: "hard", stateIds, factIds, message: "An active single-value state or legacy Canon Fact conflicts at this scene and priority." } : { kind: "none", stateIds: [], factIds: [], message: null };
}

function insertEvidence(database: DatabaseSync, projectId: string, source: SourceRevision, anchor: { anchorStart: number; anchorEnd: number; quotedText?: string | null }, modelRunId: string | null, actorId: string) {
  const parsed = evidenceAnchorSchema.parse(anchor);
  if (parsed.anchorEnd > source.content.length) throw new StoryBibleValidationError("Evidence anchor is outside the source revision", ["evidence"]);
  const quotedText = parsed.quotedText ?? source.content.slice(parsed.anchorStart, parsed.anchorEnd);
  if (quotedText !== source.content.slice(parsed.anchorStart, parsed.anchorEnd)) throw new StoryBibleValidationError("Evidence quote does not match the source revision", ["evidence", "quotedText"]);
  const id = randomUUID();
  database.prepare("INSERT INTO evidence_sources (id, project_id, kind, document_id, scene_id, scene_revision_id, revision_id, anchor_start, anchor_end, quoted_text, created_by_user_id, model_run_id, created_at) VALUES (:id, :projectId, 'text_span', :documentId, :sceneId, :sceneRevisionId, :sceneRevisionId, :anchorStart, :anchorEnd, :quotedText, :actorId, :modelRunId, :createdAt)").run({ id, projectId, documentId: source.document_id, sceneId: source.scene_id, sceneRevisionId: source.id, anchorStart: String(parsed.anchorStart), anchorEnd: String(parsed.anchorEnd), quotedText, actorId, modelRunId, createdAt: now() });
  return id;
}

function insertFact(database: DatabaseSync, projectId: string, payload: FactPatchPayload, sourceId: string, supersedesFactId: string | null, inferenceId: string | null) {
  const id = randomUUID();
  const createdAt = now();
  database.prepare("INSERT INTO facts (id, project_id, subject_entity_id, predicate, value_json, value_type, truth_class, scope, scene_id, valid_from_scene_id, valid_to_scene_id, source_id, promoted_from_inference_id, status, supersedes_fact_id, version, created_at) VALUES (:id, :projectId, :subjectEntityId, :predicate, :valueJson, :valueType, 'canon', :scope, :sceneId, :validFromSceneId, :validToSceneId, :sourceId, :inferenceId, 'active', :supersedesFactId, 1, :createdAt)").run({ id, projectId, subjectEntityId: payload.subjectEntityId, predicate: payload.predicate, valueJson: JSON.stringify(payload.value), valueType: payload.valueType, scope: payload.scope, sceneId: payload.sceneId ?? null, validFromSceneId: payload.validFromSceneId ?? null, validToSceneId: payload.validToSceneId ?? null, sourceId, inferenceId, supersedesFactId, createdAt });
  const fact = selectFact(database, id, projectId);
  if (!fact) throw new StoryBibleDataIntegrityError("Accepted fact could not be read after insertion");
  return fact;
}

function insertEntityState(database: DatabaseSync, projectId: string, payload: StatePatchPayload, sourceRevisionId: string, sourceId: string): EntityState {
  const id = randomUUID();
  const createdAt = now();
  database.prepare("INSERT INTO entity_states (id, project_id, entity_id, predicate, value_json, value_type, applies_at_scene_id, source_revision_id, continuity_group_id, carry_forward, priority, valid_to_scene_id, source_id, truth_class, status, version, created_at) VALUES (:id, :projectId, :entityId, :predicate, :valueJson, :valueType, :appliesAtSceneId, :sourceRevisionId, :continuityGroupId, :carryForward, :priority, :validToSceneId, :sourceId, 'canon', 'active', 1, :createdAt)").run({ id, projectId, entityId: payload.subjectEntityId, predicate: payload.predicate, valueJson: JSON.stringify(payload.value), valueType: payload.valueType, appliesAtSceneId: payload.appliesAtSceneId, sourceRevisionId, continuityGroupId: payload.continuityGroupId, carryForward: payload.carryForward ? 1 : 0, priority: payload.priority, validToSceneId: payload.validToSceneId, sourceId, createdAt });
  const state = selectEntityState(database, id, projectId);
  if (!state) throw new StoryBibleDataIntegrityError("Accepted entity state could not be read after insertion");
  return state;
}

function markPatchExpired(database: DatabaseSync, patch: Patch, actorId: string, requestId: string, reason: string) {
  const result = database.prepare("UPDATE pending_patches SET status = 'expired', version = version + 1, resolved_at = :resolvedAt, resolved_by_user_id = :resolvedByUserId WHERE project_id = :projectId AND id = :patchId AND status = 'pending' AND version = :version").run({ projectId: patch.projectId, patchId: patch.id, version: patch.version, resolvedAt: now(), resolvedByUserId: actorId });
  if (result.changes === 1) {
    if (patch.inferenceId) database.prepare("UPDATE inferences SET status = 'stale', version = version + 1 WHERE project_id = :projectId AND id = :inferenceId AND status = 'active'").run({ projectId: patch.projectId, inferenceId: patch.inferenceId });
    writeEvent(database, { projectId: patch.projectId, eventType: "patch.expired", aggregateType: "pending_patch", aggregateId: patch.id, aggregateVersion: patch.version + 1, requestId, actorId, payload: { reason, revalidationSuggested: true } });
  }
  return selectPatch(database, patch.id, patch.projectId) ?? patch;
}

function expireOlderPatches(database: DatabaseSync, projectId: string, sceneId: string, currentRevisionId: string, actorId: string, requestId: string) {
  const rows = database.prepare("SELECT p.id, p.project_id, p.operation, p.target_entity_id, p.target_fact_id, p.base_version, p.payload_json, p.input_fingerprint, p.truth_class, p.confidence, p.conflict_kind, p.conflicting_fact_ids_json, p.conflicting_state_ids_json, p.conflict_message, p.source_revision_id, p.inference_id, p.model_run_id, p.status, p.proposed_by, p.version, p.created_at, p.resolved_at, p.resolved_by_user_id FROM pending_patches p JOIN scene_revisions sr ON sr.id = p.source_revision_id WHERE p.project_id = :projectId AND sr.scene_id = :sceneId AND p.source_revision_id <> :currentRevisionId AND p.status = 'pending'").all({ projectId, sceneId, currentRevisionId }) as unknown as PatchRow[];
  for (const row of rows) markPatchExpired(database, toPatch(database, row), actorId, requestId, "A newer scene revision superseded the source text");
}

/**
 * Deterministically raises a reviewable retract suggestion when an accepted
 * Canon fact's text evidence disappeared from a newer revision. This helper
 * deliberately does not open a transaction: callers run it after the source
 * revision commit in an independent best-effort transaction (or wrap this
 * helper in an explicit retry command).
 */
export function revalidateSceneFactPatches(projectId: string, sceneId: string, sceneRevisionId: string, database?: DatabaseSync, actorId = "system-revalidation") {
  const db = resolveDatabase(database);
  getProject(db, projectId);
  const source = db.prepare("SELECT sr.id, sr.project_id, sr.document_id, sr.scene_id, sr.content_hash, sr.content, sr.status FROM scene_revisions sr WHERE sr.id = :sceneRevisionId AND sr.project_id = :projectId AND sr.scene_id = :sceneId").get({ sceneRevisionId, projectId, sceneId }) as unknown as SourceRevision | undefined;
  if (!source) throw new StoryBibleNotFoundError("Scene revision not found");
  const current = db.prepare("SELECT d.current_revision_id FROM script_documents d WHERE d.id = :documentId AND d.project_id = :projectId").get({ documentId: source.document_id, projectId }) as { current_revision_id?: string } | undefined;
  if (!current || current.current_revision_id !== (db.prepare("SELECT document_revision_id FROM scene_revisions WHERE id = :sceneRevisionId").get({ sceneRevisionId }) as { document_revision_id?: string } | undefined)?.document_revision_id) throw new SceneAnalysisStaleError("Revalidation requires the current scene revision");
  expireOlderPatches(db, projectId, sceneId, sceneRevisionId, actorId, `revalidation:${sceneRevisionId}`);
  const rows = db.prepare("SELECT DISTINCT f.id, f.subject_entity_id, f.predicate, f.scope, f.scene_id, f.version, es.quoted_text FROM facts f JOIN evidence_sources es ON es.id = f.source_id WHERE f.project_id = :projectId AND f.status = 'active' AND es.project_id = :projectId AND es.scene_id = :sceneId AND es.scene_revision_id <> :sceneRevisionId").all({ projectId, sceneId, sceneRevisionId }) as Array<{ id: string; subject_entity_id: string; predicate: string; scope: Fact["scope"]; scene_id: string | null; version: number; quoted_text: string | null }>;
  const suggestions: Patch[] = [];
  for (const row of rows) {
    const quote = row.quoted_text;
    if (source.status !== "deleted" && (!quote || source.content.includes(quote))) continue;
    const inputFingerprint = hashJson({ sceneRevisionId, operation: "retract_fact", targetFactId: row.id, baseVersion: row.version, reason: "source-evidence-removed" });
    const existing = db.prepare("SELECT id FROM pending_patches WHERE project_id = :projectId AND source_revision_id = :sourceRevisionId AND input_fingerprint = :inputFingerprint ORDER BY created_at DESC, id DESC LIMIT 1").get({ projectId, sourceRevisionId: sceneRevisionId, inputFingerprint }) as { id?: string } | undefined;
    if (existing?.id) {
      const patch = selectPatch(db, existing.id, projectId);
      if (patch) suggestions.push(patch);
      continue;
    }
    const createdAt = now();
    const requestId = `revalidation:${row.id}:${sceneRevisionId}`;
    const modelRunId = randomUUID();
    const outputHash = hashJson({ operation: "retract_fact", targetFactId: row.id, sceneRevisionId });
    db.prepare("INSERT INTO model_runs (id, project_id, kind, model, model_version, source_revision_id, input_hash, status, output_hash, error_code, error_message, created_at, completed_at) VALUES (:id, :projectId, 'fact_extractor', 'deterministic-revalidation', 'revalidation-v1', :sourceRevisionId, :inputHash, 'succeeded', :outputHash, NULL, NULL, :createdAt, :completedAt)").run({ id: modelRunId, projectId, sourceRevisionId: sceneRevisionId, inputHash: source.content_hash, outputHash, createdAt, completedAt: createdAt });
    const evidenceSourceId = randomUUID();
    db.prepare("INSERT INTO evidence_sources (id, project_id, kind, document_id, scene_id, scene_revision_id, revision_id, anchor_start, anchor_end, quoted_text, created_by_user_id, model_run_id, created_at) VALUES (:id, :projectId, 'model_output', :documentId, :sceneId, :sceneRevisionId, :sceneRevisionId, '0', '0', '', :actorId, :modelRunId, :createdAt)").run({ id: evidenceSourceId, projectId, documentId: source.document_id, sceneId, sceneRevisionId, actorId, modelRunId, createdAt });
    const patchId = randomUUID();
    db.prepare("INSERT INTO pending_patches (id, project_id, operation, target_entity_id, target_fact_id, base_version, payload_json, input_fingerprint, truth_class, confidence, conflict_kind, conflicting_fact_ids_json, conflicting_state_ids_json, conflict_message, source_revision_id, inference_id, model_run_id, status, proposed_by, version, created_at, resolved_at, resolved_by_user_id) VALUES (:id, :projectId, 'retract_fact', :targetEntityId, :targetFactId, :baseVersion, '{}', :inputFingerprint, 'canon', 1, 'none', '[]', '[]', :conflictMessage, :sourceRevisionId, NULL, :modelRunId, 'pending', 'rule', 1, :createdAt, NULL, NULL)").run({ id: patchId, projectId, targetEntityId: row.subject_entity_id, targetFactId: row.id, baseVersion: row.version, inputFingerprint, conflictMessage: "Source evidence disappeared; review whether this Canon fact should be retracted.", sourceRevisionId: sceneRevisionId, modelRunId, createdAt });
    db.prepare("INSERT INTO patch_evidence (project_id, patch_id, evidence_source_id, created_at) VALUES (:projectId, :patchId, :evidenceSourceId, :createdAt)").run({ projectId, patchId, evidenceSourceId, createdAt });
    const patch = selectPatch(db, patchId, projectId);
    if (!patch) throw new StoryBibleDataIntegrityError("Revalidation patch could not be read");
    writeEvent(db, { projectId, eventType: "patch.proposed", aggregateType: "pending_patch", aggregateId: patch.id, aggregateVersion: patch.version, requestId, actorId, payload: { operation: "retract_fact", targetFactId: row.id, revalidationSuggested: true } });
    suggestions.push(patch);
  }
  return suggestions;
}

export function getPatch(patchId: string, projectId: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  return selectPatch(db, patchId, projectId);
}

export function listPatchApplications(projectId: string, patchId?: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  getProject(db, projectId);
  const rows = db.prepare(`SELECT id, project_id, patch_id, operation, resulting_fact_id, resulting_state_id, applied_payload_json, request_id, created_at FROM patch_applications WHERE project_id = :projectId${patchId ? " AND patch_id = :patchId" : ""} ORDER BY created_at DESC, id DESC`).all(patchId ? { projectId, patchId } : { projectId }) as Array<{ id?: string; project_id?: string; patch_id?: string; operation?: Patch["operation"]; resulting_fact_id?: string | null; resulting_state_id?: string | null; applied_payload_json?: string; request_id?: string; created_at?: string }>;
  return rows.flatMap((row) => { const application = applicationFromRow(row); return application ? [application] : []; });
}

export function listPatchFacts(projectId: string, patchId?: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  getProject(db, projectId);
  const patches = patchId ? (selectPatch(db, patchId, projectId) ? [selectPatch(db, patchId, projectId) as Patch] : []) : listPatches(projectId, {}, db);
  const factIds = new Set<string>();
  for (const patch of patches) {
    if (patch.targetFactId) factIds.add(patch.targetFactId);
    const application = selectApplication(db, projectId, patch.id);
    if (application?.resultingFactId) factIds.add(application.resultingFactId);
  }
  return [...factIds].flatMap((factId) => { const fact = selectFact(db, factId, projectId); return fact ? [fact] : []; });
}

export function listPatchStates(projectId: string, patchId?: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  getProject(db, projectId);
  const rows = db.prepare(`SELECT es.id, es.project_id, es.entity_id, es.predicate, es.value_json, es.value_type, es.applies_at_scene_id, es.source_revision_id, es.continuity_group_id, es.carry_forward, es.priority, es.valid_to_scene_id, es.source_id, es.truth_class, es.status, es.version, es.created_at FROM patch_applications pa JOIN entity_states es ON es.id = pa.resulting_state_id AND es.project_id = pa.project_id WHERE pa.project_id = :projectId${patchId ? " AND pa.patch_id = :patchId" : ""} ORDER BY es.created_at DESC, es.id DESC`).all(patchId ? { projectId, patchId } : { projectId }) as unknown as EntityStateRow[];
  return rows.map(toEntityState);
}

export function listPatches(projectId: string, options: { status?: Patch["status"]; sceneRevisionId?: string; targetEntityId?: string } = {}, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  getProject(db, projectId);
  const conditions = ["project_id = :projectId"];
  const parameters: SqliteParameters = { projectId };
  if (options.status) { conditions.push("status = :status"); parameters.status = options.status; }
  if (options.sceneRevisionId) { conditions.push("source_revision_id = :sceneRevisionId"); parameters.sceneRevisionId = options.sceneRevisionId; }
  if (options.targetEntityId) { conditions.push("target_entity_id = :targetEntityId"); parameters.targetEntityId = options.targetEntityId; }
  const rows = db.prepare(`SELECT id, project_id, operation, target_entity_id, target_fact_id, base_version, payload_json, input_fingerprint, truth_class, confidence, conflict_kind, conflicting_fact_ids_json, conflicting_state_ids_json, conflict_message, source_revision_id, inference_id, model_run_id, status, proposed_by, version, created_at, resolved_at, resolved_by_user_id FROM pending_patches WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, id DESC`).all(parameters) as unknown as PatchRow[];
  return rows.map((row) => toPatch(db, row));
}

export function listInferences(projectId: string, options: { status?: Inference["status"]; subjectEntityId?: string } = {}, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  getProject(db, projectId);
  const conditions = ["project_id = :projectId"];
  const parameters: SqliteParameters = { projectId };
  if (options.status) { conditions.push("status = :status"); parameters.status = options.status; }
  if (options.subjectEntityId) { conditions.push("subject_entity_id = :subjectEntityId"); parameters.subjectEntityId = options.subjectEntityId; }
  const rows = db.prepare(`SELECT id, project_id, subject_entity_id, predicate, value_json, value_type, scope, scene_id, valid_from_scene_id, valid_to_scene_id, confidence, rationale, model_run_id, status, version, created_at FROM inferences WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, id DESC`).all(parameters) as unknown as InferenceRow[];
  return rows.map((row) => toInference(db, row));
}

export function getInference(inferenceId: string, projectId: string, database?: DatabaseSync) {
  return selectInference(resolveDatabase(database), inferenceId, projectId);
}

export function getModelRun(modelRunId: string, projectId: string, database?: DatabaseSync) {
  return selectModelRun(resolveDatabase(database), modelRunId, projectId);
}

export function listModelRuns(projectId: string, options: { sourceRevisionId?: string } = {}, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  getProject(db, projectId);
  const condition = options.sourceRevisionId ? " AND source_revision_id = :sourceRevisionId" : "";
  const rows = db.prepare(`SELECT id, project_id, kind, model, model_version, source_revision_id, input_hash, status, output_hash, error_code, error_message, created_at, completed_at FROM model_runs WHERE project_id = :projectId${condition} ORDER BY created_at DESC, id DESC`).all(options.sourceRevisionId ? { projectId, sourceRevisionId: options.sourceRevisionId } : { projectId }) as unknown as ModelRunRow[];
  return rows.map(toModelRun);
}

export function proposeFactPatch(projectId: string, input: ProposeFactPatchInput, database?: DatabaseSync) {
  const values = proposeFactPatchInputSchema.parse(input);
  if (values.predicate && isSceneStatePredicate(values.predicate)) throw new StoryBibleValidationError("Scene state predicates require an add_state proposal", ["predicate"]);
  const db = resolveDatabase(database);
  getProject(db, projectId);
  const result = withTransaction(db, () => {
    const requestFingerprint = proposalRequestFingerprint(values);
    const existing = getIdempotency(db, projectId, "patch.propose", values.requestId);
    if (existing) {
      if (existing.response.requestFingerprint !== requestFingerprint) throw new StoryBibleIdempotencyConflictError("This request ID was already used for a different patch proposal");
      const patch = selectPatch(db, existing.resourceId, projectId);
      if (!patch) throw new StoryBibleDataIntegrityError("Stored patch proposal no longer exists");
      return { patch, inference: patch.inferenceId ? selectInference(db, patch.inferenceId, projectId) : null, modelRun: patch.modelRunId ? selectModelRun(db, patch.modelRunId, projectId) : null, idempotent: true };
    }
    const source = currentSourceRevision(db, { projectId, documentId: values.documentId, sceneId: values.sceneId, sceneRevisionId: values.sceneRevisionId });
    const { prepared } = prepareProposal(db, projectId, values, source);
    const semanticFingerprint = proposalSemanticFingerprint({ sourceRevisionId: source.id, operation: values.operation, targetEntityId: prepared.targetEntityId, targetFactId: prepared.targetFactId, baseVersion: prepared.baseVersion, payload: prepared.payload, evidence: values.evidence });
    const semanticDuplicate = db.prepare("SELECT id FROM pending_patches WHERE project_id = :projectId AND source_revision_id = :sourceRevisionId AND input_fingerprint = :inputFingerprint ORDER BY created_at DESC, id DESC LIMIT 1").get({ projectId, sourceRevisionId: source.id, inputFingerprint: semanticFingerprint }) as { id?: string } | undefined;
    if (semanticDuplicate?.id) {
      const patch = selectPatch(db, semanticDuplicate.id, projectId);
      if (!patch) throw new StoryBibleDataIntegrityError("Semantic duplicate patch no longer exists");
      storeIdempotency(db, { projectId, operation: "patch.propose", requestId: values.requestId, resourceType: "pending_patch", resourceId: patch.id, response: { patchId: patch.id, requestFingerprint, semanticFingerprint } });
      return { patch, inference: patch.inferenceId ? selectInference(db, patch.inferenceId, projectId) : null, modelRun: patch.modelRunId ? selectModelRun(db, patch.modelRunId, projectId) : null, idempotent: true };
    }
    expireOlderPatches(db, projectId, source.scene_id, source.id, values.actorId ?? "local-user", values.requestId);
    const outputHash = hashJson({ operation: values.operation, payload: prepared.payload, evidence: values.evidence });
    const modelRunId = randomUUID();
    const createdAt = now();
    db.prepare("INSERT INTO model_runs (id, project_id, kind, model, model_version, source_revision_id, input_hash, status, output_hash, error_code, error_message, created_at, completed_at) VALUES (:id, :projectId, 'fact_extractor', :model, :modelVersion, :sourceRevisionId, :inputHash, 'succeeded', :outputHash, NULL, NULL, :createdAt, :completedAt)").run({ id: modelRunId, projectId, model: values.model, modelVersion: values.modelVersion, sourceRevisionId: source.id, inputHash: source.content_hash, outputHash, createdAt, completedAt: createdAt });
    const evidenceSourceIds = values.evidence.map((anchor) => insertEvidence(db, projectId, source, anchor, modelRunId, values.actorId ?? "local-user"));
    let inferenceId: string | null = null;
    if (values.operation !== "retract_fact") {
      const payload = prepared.payload as FactPatchPayload;
      inferenceId = randomUUID();
      db.prepare("INSERT INTO inferences (id, project_id, subject_entity_id, predicate, value_json, value_type, scope, scene_id, valid_from_scene_id, valid_to_scene_id, confidence, rationale, model_run_id, status, version, created_at) VALUES (:id, :projectId, :subjectEntityId, :predicate, :valueJson, :valueType, :scope, :sceneId, :validFromSceneId, :validToSceneId, :confidence, :rationale, :modelRunId, 'active', 1, :createdAt)").run({ id: inferenceId, projectId, subjectEntityId: payload.subjectEntityId, predicate: payload.predicate, valueJson: JSON.stringify(payload.value), valueType: payload.valueType, scope: payload.scope, sceneId: payload.sceneId ?? null, validFromSceneId: payload.validFromSceneId ?? null, validToSceneId: payload.validToSceneId ?? null, confidence: values.confidence, rationale: values.rationale ?? null, modelRunId, createdAt });
      for (const evidenceSourceId of evidenceSourceIds) db.prepare("INSERT INTO inference_evidence (project_id, inference_id, evidence_source_id, created_at) VALUES (:projectId, :inferenceId, :evidenceSourceId, :createdAt)").run({ projectId, inferenceId, evidenceSourceId, createdAt });
    }
    const conflict = values.operation === "retract_fact" ? { kind: "none" as const, ids: [], message: null } : detectConflict(db, projectId, prepared.payload as FactPatchPayload, prepared.targetFactId);
    const patchId = randomUUID();
    db.prepare("INSERT INTO pending_patches (id, project_id, operation, target_entity_id, target_fact_id, base_version, payload_json, input_fingerprint, truth_class, confidence, conflict_kind, conflicting_fact_ids_json, conflict_message, source_revision_id, inference_id, model_run_id, status, proposed_by, version, created_at, resolved_at, resolved_by_user_id) VALUES (:id, :projectId, :operation, :targetEntityId, :targetFactId, :baseVersion, :payloadJson, :inputFingerprint, 'canon', :confidence, :conflictKind, :conflictingFactIdsJson, :conflictMessage, :sourceRevisionId, :inferenceId, :modelRunId, 'pending', :proposedBy, 1, :createdAt, NULL, NULL)").run({ id: patchId, projectId, operation: values.operation, targetEntityId: prepared.targetEntityId, targetFactId: prepared.targetFactId, baseVersion: prepared.baseVersion, payloadJson: JSON.stringify(prepared.payload), inputFingerprint: semanticFingerprint, confidence: values.confidence, conflictKind: conflict.kind, conflictingFactIdsJson: JSON.stringify(conflict.ids), conflictMessage: conflict.message, sourceRevisionId: source.id, inferenceId, modelRunId, proposedBy: values.proposedBy, createdAt });
    for (const evidenceSourceId of evidenceSourceIds) db.prepare("INSERT INTO patch_evidence (project_id, patch_id, evidence_source_id, created_at) VALUES (:projectId, :patchId, :evidenceSourceId, :createdAt)").run({ projectId, patchId, evidenceSourceId, createdAt });
    const patch = selectPatch(db, patchId, projectId);
    if (!patch) throw new StoryBibleDataIntegrityError("Patch could not be read after proposal");
    storeIdempotency(db, { projectId, operation: "patch.propose", requestId: values.requestId, resourceType: "pending_patch", resourceId: patch.id, response: { patchId: patch.id, requestFingerprint, semanticFingerprint } });
    writeEvent(db, { projectId, eventType: "patch.proposed", aggregateType: "pending_patch", aggregateId: patch.id, aggregateVersion: patch.version, requestId: values.requestId, actorId: values.actorId, payload: { operation: patch.operation, inferenceId, modelRunId, conflictKind: patch.conflictKind } });
    return { patch, inference: inferenceId ? selectInference(db, inferenceId, projectId) : null, modelRun: selectModelRun(db, modelRunId, projectId), idempotent: false };
  });
  return result;
}

function stateProposalFingerprint(values: ProposeStatePatchInput) {
  return hashJson({
    documentId: values.documentId,
    sceneId: values.sceneId,
    sceneRevisionId: values.sceneRevisionId,
    subjectEntityId: values.subjectEntityId,
    predicate: values.predicate,
    value: values.value,
    valueType: values.valueType ?? null,
    carryForward: values.carryForward,
    priority: values.priority,
    validToSceneId: values.validToSceneId,
    baseVersion: values.baseVersion,
    evidence: values.evidence.map((anchor) => ({ anchorStart: anchor.anchorStart, anchorEnd: anchor.anchorEnd, quotedText: anchor.quotedText ?? null })),
    actorId: values.actorId,
  });
}

function validateStateValue(database: DatabaseSync, projectId: string, predicate: ProposeStatePatchInput["predicate"], value: string, subjectEntityId: string) {
  const subject = getEntityForProject(projectId, subjectEntityId, database);
  if (!subject) throw new StoryBibleNotFoundError("Subject entity not found");
  if (subject.type !== "character" || !["active", "draft"].includes(subject.status) || subject.mergedIntoEntityId !== null) throw new StoryBibleValidationError("Scene state subject must be an active or draft character", ["subjectEntityId"]);
  if (predicate === "state.held_prop") {
    const prop = getEntityForProject(projectId, value, database);
    if (!prop) throw new StoryBibleNotFoundError("Prop entity not found");
    if (prop.type !== "prop" || !["active", "draft"].includes(prop.status) || prop.mergedIntoEntityId !== null) throw new StoryBibleValidationError("held_prop value must reference an active or draft Prop in the same project", ["value"]);
    return { valueType: "entity_ref" as const };
  }
  return { valueType: "string" as const };
}

function prepareStateProposal(database: DatabaseSync, projectId: string, values: ParsedProposeStatePatchInput, source: SourceRevision) {
  const group = database.prepare("SELECT continuity_group_id FROM scene_revisions WHERE id = :revisionId AND project_id = :projectId").get({ revisionId: source.id, projectId }) as { continuity_group_id?: string } | undefined;
  if (!group?.continuity_group_id) throw new StoryBibleDataIntegrityError("Source revision continuity group is missing");
  const subject = getEntityForProject(projectId, values.subjectEntityId, database);
  if (!subject) throw new StoryBibleNotFoundError("Subject entity not found");
  if (subject.version !== values.baseVersion) throw new StoryBibleConflictError("entity", subject);
  const valueType = validateStateValue(database, projectId, values.predicate, values.value, values.subjectEntityId).valueType;
  if (!values.carryForward && values.validToSceneId !== null) throw new StoryBibleValidationError("validToSceneId requires carryForward", ["validToSceneId"]);
  if (values.validToSceneId !== null) {
    const end = getScenePosition(database, projectId, values.validToSceneId, ["validToSceneId"], source.document_id);
    const sourceScene = getScenePosition(database, projectId, source.scene_id, ["sceneId"], source.document_id);
    if (end.narrative_rank < sourceScene.narrative_rank) throw new StoryBibleValidationError("validToSceneId must not precede the applies-at scene", ["validToSceneId"]);
    const endGroup = database.prepare("SELECT continuity_group_id FROM scenes WHERE id = :sceneId AND project_id = :projectId").get({ sceneId: values.validToSceneId, projectId }) as { continuity_group_id?: string } | undefined;
    if (endGroup?.continuity_group_id !== group.continuity_group_id) throw new StoryBibleValidationError("validToSceneId must belong to the source continuity group", ["validToSceneId"]);
  }
  const payload: StatePatchPayload = statePatchPayloadSchema.parse({
    subjectEntityId: values.subjectEntityId,
    predicate: values.predicate,
    value: values.value,
    valueType,
    appliesAtSceneId: source.scene_id,
    validToSceneId: values.validToSceneId,
    continuityGroupId: group.continuity_group_id,
    carryForward: values.carryForward,
    priority: values.priority,
  });
  return { payload, subject };
}

/** Propose a user-authored add_state command. No ModelRun or Inference is
 * created: state is explicit input and enters the same Patch review plane. */
export function proposeStatePatch(projectId: string, input: ProposeStatePatchInput, database?: DatabaseSync) {
  const values = proposeStatePatchInputSchema.parse(input);
  const db = resolveDatabase(database);
  getProject(db, projectId);
  return withTransaction(db, () => {
    const requestFingerprint = stateProposalFingerprint(values);
    const existing = getIdempotency(db, projectId, "patch.propose-state", values.requestId);
    if (existing) {
      if (existing.response.requestFingerprint !== requestFingerprint) throw new StoryBibleIdempotencyConflictError("This request ID was already used for a different state proposal");
      const patch = selectPatch(db, existing.resourceId, projectId);
      if (!patch) throw new StoryBibleDataIntegrityError("Stored state proposal no longer exists");
      return { patch, state: null as EntityState | null, inference: null, modelRun: null, idempotent: true };
    }
    const source = currentSourceRevision(db, { projectId, documentId: values.documentId, sceneId: values.sceneId, sceneRevisionId: values.sceneRevisionId });
    const { payload, subject } = prepareStateProposal(db, projectId, values, source);
    const semanticFingerprint = hashJson({ sourceRevisionId: source.id, operation: "add_state", targetEntityId: subject.id, baseVersion: subject.version, payload, evidence: values.evidence.map((anchor) => ({ anchorStart: anchor.anchorStart, anchorEnd: anchor.anchorEnd })) });
    const semanticDuplicate = db.prepare("SELECT id FROM pending_patches WHERE project_id = :projectId AND source_revision_id = :sourceRevisionId AND input_fingerprint = :inputFingerprint ORDER BY created_at DESC, id DESC LIMIT 1").get({ projectId, sourceRevisionId: source.id, inputFingerprint: semanticFingerprint }) as { id?: string } | undefined;
    if (semanticDuplicate?.id) {
      const patch = selectPatch(db, semanticDuplicate.id, projectId);
      if (!patch) throw new StoryBibleDataIntegrityError("Semantic duplicate state patch no longer exists");
      storeIdempotency(db, { projectId, operation: "patch.propose-state", requestId: values.requestId, resourceType: "pending_patch", resourceId: patch.id, response: { patchId: patch.id, requestFingerprint, semanticFingerprint } });
      return { patch, state: null as EntityState | null, inference: null, modelRun: null, idempotent: true };
    }
    expireOlderPatches(db, projectId, source.scene_id, source.id, values.actorId, values.requestId);
    const conflict = detectStateConflict(db, projectId, payload, source);
    const createdAt = now();
    const evidenceSourceIds = values.evidence.map((anchor) => insertEvidence(db, projectId, source, anchor, null, values.actorId));
    const patchId = randomUUID();
    db.prepare("INSERT INTO pending_patches (id, project_id, operation, target_entity_id, target_fact_id, base_version, payload_json, input_fingerprint, truth_class, confidence, conflict_kind, conflicting_fact_ids_json, conflicting_state_ids_json, conflict_message, source_revision_id, inference_id, model_run_id, status, proposed_by, version, created_at, resolved_at, resolved_by_user_id) VALUES (:id, :projectId, 'add_state', :targetEntityId, NULL, :baseVersion, :payloadJson, :inputFingerprint, 'canon', NULL, :conflictKind, :conflictingFactIdsJson, :conflictingStateIdsJson, :conflictMessage, :sourceRevisionId, NULL, NULL, 'pending', 'user', 1, :createdAt, NULL, NULL)").run({ id: patchId, projectId, targetEntityId: subject.id, baseVersion: subject.version, payloadJson: JSON.stringify(payload), inputFingerprint: semanticFingerprint, conflictKind: conflict.kind, conflictingFactIdsJson: JSON.stringify(conflict.factIds), conflictingStateIdsJson: JSON.stringify(conflict.stateIds), conflictMessage: conflict.message, sourceRevisionId: source.id, createdAt });
    for (const evidenceSourceId of evidenceSourceIds) db.prepare("INSERT INTO patch_evidence (project_id, patch_id, evidence_source_id, created_at) VALUES (:projectId, :patchId, :evidenceSourceId, :createdAt)").run({ projectId, patchId, evidenceSourceId, createdAt });
    const patch = selectPatch(db, patchId, projectId);
    if (!patch) throw new StoryBibleDataIntegrityError("State patch could not be read after proposal");
    storeIdempotency(db, { projectId, operation: "patch.propose-state", requestId: values.requestId, resourceType: "pending_patch", resourceId: patch.id, response: { patchId: patch.id, requestFingerprint, semanticFingerprint } });
    writeEvent(db, { projectId, eventType: "patch.proposed", aggregateType: "pending_patch", aggregateId: patch.id, aggregateVersion: patch.version, requestId: values.requestId, actorId: values.actorId, payload: { operation: patch.operation, explicitState: true } });
    return { patch, state: null as EntityState | null, inference: null, modelRun: null, idempotent: false };
  });
}

function resolveAcceptancePayload(database: DatabaseSync, projectId: string, patch: Patch, source: SourceRevision, editedPayload?: unknown) {
  if (patch.operation === "add_state") {
    const payload = editedPayload ?? patch.payload;
    return statePatchPayloadSchema.parse(payload);
  }
  if (patch.operation === "retract_fact") {
    if (editedPayload !== undefined) retractFactPatchPayloadSchema.parse(editedPayload);
    return {} as Record<string, never>;
  }
  const payload = editedPayload ?? patch.payload;
  return validatePayload(database, projectId, patch.operation, payload, source, patch.targetFactId) as FactPatchPayload;
}

function assertEditedPayloadIdentity(patch: Patch, payload: FactPatchPayload | StatePatchPayload) {
  if (patch.operation === "add_state") {
    const original = statePatchPayloadSchema.parse(patch.payload);
    const edited = statePatchPayloadSchema.parse(payload);
    const identityFields: Array<keyof StatePatchPayload> = ["subjectEntityId", "predicate", "valueType", "appliesAtSceneId", "validToSceneId", "continuityGroupId", "carryForward", "priority"];
    for (const field of identityFields) {
      if (JSON.stringify(original[field]) !== JSON.stringify(edited[field])) throw new StoryBibleValidationError("Edited state payload may change value only; subject, predicate, type, scene, group, carry-forward, priority, and range are immutable", ["payload", field]);
    }
    return;
  }
  if (patch.operation === "retract_fact") return;
  const original = factPatchPayloadSchema.parse(patch.payload);
  const factPayload = payload as FactPatchPayload;
  const identityFields: Array<keyof FactPatchPayload> = ["subjectEntityId", "predicate", "valueType", "scope", "sceneId", "validFromSceneId", "validToSceneId"];
  for (const field of identityFields) {
    if (JSON.stringify(original[field]) !== JSON.stringify(factPayload[field])) throw new StoryBibleValidationError("Edited payload may change value only; subject, predicate, valueType, scope, and scene bounds are immutable", ["payload", field]);
  }
}

function assertEvidenceStillValid(database: DatabaseSync, patch: Patch, source: SourceRevision) {
  const rows = database.prepare("SELECT es.scene_revision_id, es.anchor_start, es.anchor_end, es.quoted_text FROM patch_evidence pe JOIN evidence_sources es ON es.id = pe.evidence_source_id WHERE pe.project_id = :projectId AND pe.patch_id = :patchId").all({ projectId: patch.projectId, patchId: patch.id }) as Array<{ scene_revision_id: string | null; anchor_start: string | null; anchor_end: string | null; quoted_text: string | null }>;
  if (rows.length === 0) throw new StoryBibleValidationError("Patch has no evidence", ["evidenceSourceIds"]);
  for (const row of rows) {
    if (row.scene_revision_id !== source.id || row.anchor_start === null || row.anchor_end === null) throw new SceneAnalysisStaleError("Patch evidence belongs to an older scene revision");
    const start = Number(row.anchor_start);
    const end = Number(row.anchor_end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || end > source.content.length || source.content.slice(start, end) !== row.quoted_text) throw new SceneAnalysisStaleError("Patch evidence no longer matches the source revision");
  }
}

type AcceptanceResult = { patch: Patch; fact: Fact | null; state: EntityState | null; application: PatchApplication | null; idempotent: boolean };

function acceptanceFingerprint(patchId: string, expectedVersion: number, payload: unknown, operation: string, actorId: string) {
  return hashJson({ patchId, expectedVersion, operation, payload, actorId });
}

export function acceptPatch(projectId: string, patchId: string, input: AcceptPatchInput, database?: DatabaseSync): AcceptanceResult {
  const values = acceptPatchInputSchema.parse(input);
  return applyPatch(projectId, patchId, values, undefined, database);
}

export function acceptEditedPatch(projectId: string, patchId: string, input: AcceptEditedPatchInput, database?: DatabaseSync): AcceptanceResult {
  const values = acceptEditedPatchInputSchema.parse(input);
  return applyPatch(projectId, patchId, values, values.payload, database);
}

function applyPatch(projectId: string, patchId: string, values: AcceptPatchInput | AcceptEditedPatchInput, editedPayload: unknown, database?: DatabaseSync): AcceptanceResult {
  const db = resolveDatabase(database);
  getProject(db, projectId);
  let expiredError: StoryBiblePatchConflictError | null = null;
  const result = withTransaction(db, () => {
    const existing = selectPatch(db, patchId, projectId);
    if (!existing) throw new StoryBibleNotFoundError("Patch not found");
    const inputFingerprint = acceptanceFingerprint(patchId, values.expectedVersion, editedPayload ?? existing.payload, existing.operation, values.actorId ?? "local-user");
    const idempotent = getIdempotency(db, projectId, "patch.accept", values.requestId);
    if (idempotent) {
      if (idempotent.response.inputFingerprint !== inputFingerprint) throw new StoryBibleIdempotencyConflictError("This request ID was already used for a different patch acceptance");
      const patch = selectPatch(db, patchId, projectId) ?? existing;
      const resultFactId = typeof idempotent.response.resultFactId === "string" ? idempotent.response.resultFactId : null;
      const resultStateId = typeof idempotent.response.resultStateId === "string" ? idempotent.response.resultStateId : null;
      return { patch, fact: resultFactId ? selectFact(db, resultFactId, projectId) : null, state: resultStateId ? selectEntityState(db, resultStateId, projectId) : null, application: selectApplication(db, projectId, patchId, values.requestId), idempotent: true };
    }
    if (existing.status !== "pending") throw new StoryBiblePatchResolvedError(existing);
    if (existing.version !== values.expectedVersion) throw new StoryBiblePatchConflictError(existing, "The pending patch changed on the server. Review it before accepting again.");
    let source: SourceRevision;
    try {
      source = currentSourceRevision(db, { projectId, documentId: (db.prepare("SELECT document_id FROM scene_revisions WHERE id = :revisionId AND project_id = :projectId").get({ revisionId: existing.sourceRevisionId, projectId }) as { document_id?: string } | undefined)?.document_id ?? "", sceneId: (db.prepare("SELECT scene_id FROM scene_revisions WHERE id = :revisionId AND project_id = :projectId").get({ revisionId: existing.sourceRevisionId, projectId }) as { scene_id?: string } | undefined)?.scene_id ?? "", sceneRevisionId: existing.sourceRevisionId }, existing.operation === "retract_fact");
      assertEvidenceStillValid(db, existing, source);
    } catch (error) {
      const expired = markPatchExpired(db, existing, values.actorId ?? "local-user", values.requestId, error instanceof Error ? error.message : "Source revision is no longer valid");
      expiredError = new StoryBiblePatchConflictError(expired, "The patch source revision is stale; it was expired and needs revalidation.");
      return { patch: expired, fact: null, state: null, application: null, idempotent: false };
    }
    const payload = resolveAcceptancePayload(db, projectId, existing, source, editedPayload);
    if (editedPayload !== undefined) assertEditedPayloadIdentity(existing, payload as FactPatchPayload);
    if (existing.operation === "add_fact" && existing.targetEntityId && (payload as FactPatchPayload).subjectEntityId !== existing.targetEntityId) {
      throw new StoryBibleValidationError("Edited payload cannot change the target entity", ["payload", "subjectEntityId"]);
    }
    if (existing.operation === "add_state") {
      const statePayload = payload as StatePatchPayload;
      if (!existing.targetEntityId || statePayload.subjectEntityId !== existing.targetEntityId) {
        throw new StoryBibleValidationError("State payload subject must match the pending patch target", ["payload", "subjectEntityId"]);
      }
      const expectedValueType = validateStateValue(db, projectId, statePayload.predicate, statePayload.value, statePayload.subjectEntityId).valueType;
      if (statePayload.valueType !== expectedValueType) {
        throw new StoryBibleValidationError(`State predicate requires valueType ${expectedValueType}`, ["payload", "valueType"]);
      }
    }
    let targetFact = existing.targetFactId ? selectFact(db, existing.targetFactId, projectId) : null;
    if (existing.operation !== "add_state" && (existing.operation === "replace_fact" || existing.operation === "retract_fact") && (!targetFact || targetFact.status !== "active")) throw new StoryBiblePatchConflictError(existing, "The target Canon fact is no longer active.");
    if (existing.operation !== "add_state" && targetFact && existing.baseVersion !== targetFact.version) throw new StoryBiblePatchConflictError(existing, "The target Canon fact changed after this patch was proposed.");
    if ((existing.operation === "add_fact" || existing.operation === "add_state") && existing.targetEntityId) {
      const entity = getEntityForProject(projectId, existing.targetEntityId, db);
      if (existing.baseVersion !== entity.version) throw new StoryBiblePatchConflictError(existing, "The target entity changed after this patch was proposed.");
    }
    if (existing.operation === "add_state") {
      const stateConflict = detectStateConflict(db, projectId, payload as StatePatchPayload, source);
      if (stateConflict.kind === "hard") throw new StoryBiblePatchConflictError({ ...existing, conflictKind: stateConflict.kind, conflictingFactIds: stateConflict.factIds, conflictingStateIds: stateConflict.stateIds, conflictMessage: stateConflict.message }, stateConflict.message ?? "The state patch conflicts with Canon.");
    }
    const conflict = existing.operation === "retract_fact" || existing.operation === "add_state" ? { kind: "none" as const, ids: [], message: null } : detectConflict(db, projectId, payload as FactPatchPayload, existing.targetFactId);
    if (conflict.kind === "hard") throw new StoryBiblePatchConflictError({ ...existing, conflictKind: conflict.kind, conflictingFactIds: conflict.ids, conflictMessage: conflict.message }, conflict.message ?? "The patch conflicts with Canon.");
    const evidenceSourceId = existing.evidenceSourceIds[0];
    if (!evidenceSourceId) throw new StoryBibleValidationError("Patch has no evidence", ["evidenceSourceIds"]);
    if (targetFact && existing.operation === "replace_fact") {
      const result = db.prepare("UPDATE facts SET status = 'superseded', version = version + 1 WHERE project_id = :projectId AND id = :factId AND status = 'active' AND version = :version").run({ projectId, factId: targetFact.id, version: targetFact.version });
      if (result.changes !== 1) throw new StoryBibleConflictError("fact", selectFact(db, targetFact.id, projectId) ?? targetFact);
      targetFact = selectFact(db, targetFact.id, projectId);
    }
    let fact: Fact | null = null;
    let state: EntityState | null = null;
    if (existing.operation === "add_fact" || existing.operation === "replace_fact") fact = insertFact(db, projectId, payload as FactPatchPayload, evidenceSourceId, existing.operation === "replace_fact" ? existing.targetFactId : null, existing.inferenceId);
    if (existing.operation === "add_state") state = insertEntityState(db, projectId, payload as StatePatchPayload, source.id, evidenceSourceId);
    if (existing.operation === "retract_fact" && targetFact) {
      const result = db.prepare("UPDATE facts SET status = 'retracted', version = version + 1 WHERE project_id = :projectId AND id = :factId AND status = 'active' AND version = :version").run({ projectId, factId: targetFact.id, version: targetFact.version });
      if (result.changes !== 1) throw new StoryBibleConflictError("fact", selectFact(db, targetFact.id, projectId) ?? targetFact);
      fact = selectFact(db, targetFact.id, projectId);
    }
    if (existing.inferenceId) db.prepare("UPDATE inferences SET status = 'promoted', version = version + 1 WHERE id = :inferenceId AND project_id = :projectId AND status = 'active'").run({ inferenceId: existing.inferenceId, projectId });
    const applicationId = randomUUID();
    const applicationCreatedAt = now();
    db.prepare("INSERT INTO patch_applications (id, project_id, patch_id, operation, resulting_fact_id, resulting_state_id, applied_payload_json, request_id, created_at) VALUES (:id, :projectId, :patchId, :operation, :resultingFactId, :resultingStateId, :appliedPayloadJson, :requestId, :createdAt)").run({ id: applicationId, projectId, patchId, operation: existing.operation, resultingFactId: fact?.id ?? null, resultingStateId: state?.id ?? null, appliedPayloadJson: JSON.stringify(payload), requestId: values.requestId, createdAt: applicationCreatedAt });
    const application = patchApplicationSchema.parse({ id: applicationId, projectId, patchId, operation: existing.operation, resultingFactId: fact?.id ?? null, resultingStateId: state?.id ?? null, appliedPayload: payload, requestId: values.requestId, createdAt: applicationCreatedAt });
    writeEvent(db, { projectId, eventType: "patch.accepted", aggregateType: "pending_patch", aggregateId: patchId, aggregateVersion: existing.version + 1, requestId: values.requestId, actorId: values.actorId, payload: { operation: existing.operation, resultingFactId: fact?.id ?? null, resultingStateId: state?.id ?? null, edited: editedPayload !== undefined } });
    writeEvent(db, { projectId, eventType: "story_bible.changed", aggregateType: "story_bible", aggregateId: patchId, aggregateVersion: existing.version + 1, requestId: values.requestId, actorId: values.actorId, payload: { patchId, factId: fact?.id ?? null, stateId: state?.id ?? null, operation: existing.operation } });
    const patchUpdate = db.prepare("UPDATE pending_patches SET status = 'accepted', version = version + 1, resolved_at = :resolvedAt, resolved_by_user_id = :resolvedByUserId WHERE project_id = :projectId AND id = :patchId AND status = 'pending' AND version = :version").run({ projectId, patchId, version: existing.version, resolvedAt: now(), resolvedByUserId: values.actorId ?? "local-user" });
    if (patchUpdate.changes !== 1) throw new StoryBiblePatchConflictError(selectPatch(db, patchId, projectId) ?? existing, "The pending patch changed while it was being accepted.");
    const updatedPatch = selectPatch(db, patchId, projectId);
    if (!updatedPatch) throw new StoryBibleDataIntegrityError("Accepted patch could not be read");
    storeIdempotency(db, { projectId, operation: "patch.accept", requestId: values.requestId, resourceType: "pending_patch", resourceId: patchId, response: { patchId, resultFactId: fact?.id ?? null, resultStateId: state?.id ?? null, inputFingerprint } });
    return { patch: updatedPatch, fact, state, application, idempotent: false };
  }) as AcceptanceResult;
  if (expiredError) throw expiredError;
  return result;
}

export function rejectPatch(projectId: string, patchId: string, input: RejectPatchInput, database?: DatabaseSync) {
  const values = rejectPatchInputSchema.parse(input);
  const db = resolveDatabase(database);
  getProject(db, projectId);
  return withTransaction(db, () => {
    const patch = selectPatch(db, patchId, projectId);
    if (!patch) throw new StoryBibleNotFoundError("Patch not found");
    const inputFingerprint = hashJson({ patchId, expectedVersion: values.expectedVersion, reason: values.reason ?? null, operation: "reject", actorId: values.actorId ?? "local-user" });
    const existing = getIdempotency(db, projectId, "patch.reject", values.requestId);
    if (existing) {
      if (existing.response.inputFingerprint !== inputFingerprint) throw new StoryBibleIdempotencyConflictError("This request ID was already used for a different patch rejection");
      return { patch: selectPatch(db, patchId, projectId) ?? patch, idempotent: true };
    }
    if (patch.status !== "pending") throw new StoryBiblePatchResolvedError(patch);
    if (patch.version !== values.expectedVersion) throw new StoryBiblePatchConflictError(patch, "The pending patch changed on the server. Review it before rejecting again.");
    const result = db.prepare("UPDATE pending_patches SET status = 'rejected', version = version + 1, resolved_at = :resolvedAt, resolved_by_user_id = :resolvedByUserId WHERE project_id = :projectId AND id = :patchId AND status = 'pending' AND version = :version").run({ projectId, patchId, version: patch.version, resolvedAt: now(), resolvedByUserId: values.actorId ?? "local-user" });
    if (result.changes !== 1) throw new StoryBiblePatchConflictError(selectPatch(db, patchId, projectId) ?? patch, "The pending patch changed while it was being rejected.");
    const updated = selectPatch(db, patchId, projectId);
    if (!updated) throw new StoryBibleDataIntegrityError("Rejected patch could not be read");
    if (patch.inferenceId) db.prepare("UPDATE inferences SET status = 'dismissed', version = version + 1 WHERE id = :inferenceId AND project_id = :projectId AND status = 'active'").run({ inferenceId: patch.inferenceId, projectId });
    storeIdempotency(db, { projectId, operation: "patch.reject", requestId: values.requestId, resourceType: "pending_patch", resourceId: patchId, response: { patchId, inputFingerprint } });
    writeEvent(db, { projectId, eventType: "patch.rejected", aggregateType: "pending_patch", aggregateId: patchId, aggregateVersion: updated.version, requestId: values.requestId, actorId: values.actorId, payload: { reason: values.reason ?? null } });
    return { patch: updated, idempotent: false };
  });
}

export function createCanonPatchRepository(database: DatabaseSync = getDatabase()) {
  return {
    getPatch: (patchId: string, projectId: string) => getPatch(patchId, projectId, database),
    listPatchApplications: (projectId: string, patchId?: string) => listPatchApplications(projectId, patchId, database),
    listPatchFacts: (projectId: string, patchId?: string) => listPatchFacts(projectId, patchId, database),
    listPatchStates: (projectId: string, patchId?: string) => listPatchStates(projectId, patchId, database),
    listPatches: (projectId: string, options?: { status?: Patch["status"]; sceneRevisionId?: string; targetEntityId?: string }) => listPatches(projectId, options, database),
    listInferences: (projectId: string, options?: { status?: Inference["status"]; subjectEntityId?: string }) => listInferences(projectId, options, database),
    getInference: (inferenceId: string, projectId: string) => getInference(inferenceId, projectId, database),
    getModelRun: (modelRunId: string, projectId: string) => getModelRun(modelRunId, projectId, database),
    listModelRuns: (projectId: string, options?: { sourceRevisionId?: string }) => listModelRuns(projectId, options, database),
    proposeFactPatch: (projectId: string, input: ProposeFactPatchInput) => proposeFactPatch(projectId, input, database),
    proposeStatePatch: (projectId: string, input: ProposeStatePatchInput) => proposeStatePatch(projectId, input, database),
    acceptPatch: (projectId: string, patchId: string, input: AcceptPatchInput) => acceptPatch(projectId, patchId, input, database),
    acceptEditedPatch: (projectId: string, patchId: string, input: AcceptEditedPatchInput) => acceptEditedPatch(projectId, patchId, input, database),
    rejectPatch: (projectId: string, patchId: string, input: RejectPatchInput) => rejectPatch(projectId, patchId, input, database),
  };
}
