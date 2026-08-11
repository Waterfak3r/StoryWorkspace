import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  createEntityAliasInputSchema,
  createEntityInputSchema,
  createEvidenceSourceInputSchema,
  createFactInputSchema,
  entityAliasSchema,
  entitySchema,
  evidenceSourceSchema,
  factSchema,
  getPredicateDefinition,
  normalizeAlias,
  retractFactInputSchema,
  supersedeFactInputSchema,
  updateEntityInputSchema,
  validatePredicateValue,
  type AuditEvent,
  type CreateEntityAliasInput,
  type CreateEntityInput,
  type CreateEvidenceSourceInput,
  type CreateFactInput,
  type Entity,
  type EntityAlias,
  type EvidenceSource,
  type Fact,
  type OutboxEvent,
  type RetractFactInput,
  type SupersedeFactInput,
  type UpdateEntityInput,
} from "@/domain/story-bible";
import { getDatabase } from "./connection";
import {
  StoryBibleConflictError,
  StoryBibleDataIntegrityError,
  StoryBibleNotFoundError,
  StoryBibleValidationError,
} from "./story-bible-errors";

type SqliteParameters = Record<string, string | number | null>;

type EntityRow = {
  id: string;
  project_id: string;
  entity_type: Entity["type"];
  canonical_name: string;
  status: Entity["status"];
  merged_into_entity_id: string | null;
  attributes_json: string;
  schema_version: number;
  version: number;
  created_at: string;
  updated_at: string;
};

type EntityAliasRow = {
  id: string;
  project_id: string;
  entity_id: string;
  alias: string;
  normalized_alias: string;
  locale: string | null;
  status: EntityAlias["status"];
  created_at: string;
};

type EvidenceSourceRow = {
  id: string;
  project_id: string;
  kind: EvidenceSource["kind"];
  document_id: string | null;
  scene_id: string | null;
  scene_revision_id: string | null;
  anchor_start: string | null;
  anchor_end: string | null;
  quoted_text: string | null;
  created_by_user_id: string | null;
  model_run_id: string | null;
  created_at: string;
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

type ProjectRow = { id: string };

function resolveDatabase(database?: DatabaseSync) {
  return database ?? getDatabase();
}

function now() {
  return new Date().toISOString();
}

function nextRevisionTimestamp(currentUpdatedAt: string) {
  const currentMillis = Date.parse(currentUpdatedAt);
  const candidate = now();
  const candidateMillis = Date.parse(candidate);
  return Number.isFinite(currentMillis) && candidateMillis <= currentMillis
    ? new Date(currentMillis + 1).toISOString()
    : candidate;
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

function toEntity(row: EntityRow): Entity {
  const attributes = parseJson(row.attributes_json, `Invalid attributes for entity ${row.id}`);
  if (attributes === null || typeof attributes !== "object" || Array.isArray(attributes)) throw new StoryBibleDataIntegrityError(`Invalid attributes for entity ${row.id}`);
  return entitySchema.parse({ id: row.id, projectId: row.project_id, type: row.entity_type, canonicalName: row.canonical_name, status: row.status, mergedIntoEntityId: row.merged_into_entity_id, attributes, schemaVersion: row.schema_version, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at });
}

function toAlias(row: EntityAliasRow): EntityAlias {
  return entityAliasSchema.parse({ id: row.id, projectId: row.project_id, entityId: row.entity_id, alias: row.alias, normalizedAlias: row.normalized_alias, locale: row.locale, status: row.status, createdAt: row.created_at });
}

function toEvidenceSource(row: EvidenceSourceRow): EvidenceSource {
  return evidenceSourceSchema.parse({ id: row.id, projectId: row.project_id, kind: row.kind, documentId: row.document_id, sceneId: row.scene_id, revisionId: row.scene_revision_id, sceneRevisionId: row.scene_revision_id, anchorStart: row.anchor_start, anchorEnd: row.anchor_end, quotedText: row.quoted_text, createdByUserId: row.created_by_user_id, modelRunId: row.model_run_id, createdAt: row.created_at });
}

function toFact(row: FactRow): Fact {
  return factSchema.parse({ id: row.id, projectId: row.project_id, subjectEntityId: row.subject_entity_id, predicate: row.predicate, value: parseJson(row.value_json, `Invalid value for fact ${row.id}`), valueType: row.value_type, truthClass: row.truth_class, scope: row.scope, sceneId: row.scene_id, validFromSceneId: row.valid_from_scene_id, validToSceneId: row.valid_to_scene_id, sourceId: row.source_id, promotedFromInferenceId: row.promoted_from_inference_id, status: row.status, supersedesFactId: row.supersedes_fact_id, version: row.version, createdAt: row.created_at });
}

function getProject(database: DatabaseSync, projectId: string) {
  const row = database.prepare("SELECT id FROM projects WHERE id = :projectId").get({ projectId }) as unknown as ProjectRow | undefined;
  if (!row) throw new StoryBibleNotFoundError("Project not found");
}

function getEntityWithDatabase(entityId: string, database: DatabaseSync) {
  const row = database.prepare("SELECT id, project_id, entity_type, canonical_name, status, merged_into_entity_id, attributes_json, schema_version, version, created_at, updated_at FROM entities WHERE id = :entityId").get({ entityId }) as unknown as EntityRow | undefined;
  return row ? toEntity(row) : null;
}

function getEntityInProject(entityId: string, projectId: string, database: DatabaseSync) {
  const entity = getEntityWithDatabase(entityId, database);
  if (!entity || entity.projectId !== projectId) throw new StoryBibleNotFoundError("Entity not found");
  return entity;
}

function getAliasWithDatabase(aliasId: string, database: DatabaseSync) {
  const row = database.prepare("SELECT id, project_id, entity_id, alias, normalized_alias, locale, status, created_at FROM entity_aliases WHERE id = :aliasId").get({ aliasId }) as unknown as EntityAliasRow | undefined;
  return row ? toAlias(row) : null;
}

function getEvidenceWithDatabase(sourceId: string, database: DatabaseSync) {
  const row = database.prepare("SELECT id, project_id, kind, document_id, scene_id, scene_revision_id, anchor_start, anchor_end, quoted_text, created_by_user_id, model_run_id, created_at FROM evidence_sources WHERE id = :sourceId").get({ sourceId }) as unknown as EvidenceSourceRow | undefined;
  return row ? toEvidenceSource(row) : null;
}

function getFactWithDatabase(factId: string, database: DatabaseSync) {
  const row = database.prepare("SELECT id, project_id, subject_entity_id, predicate, value_json, value_type, truth_class, scope, scene_id, valid_from_scene_id, valid_to_scene_id, source_id, promoted_from_inference_id, status, supersedes_fact_id, version, created_at FROM facts WHERE id = :factId").get({ factId }) as unknown as FactRow | undefined;
  return row ? toFact(row) : null;
}

function getIdempotentResponse(database: DatabaseSync, projectId: string, operation: string, requestId: string) {
  const row = database.prepare("SELECT response_json FROM idempotency_keys WHERE project_id = :projectId AND operation = :operation AND request_id = :requestId").get({ projectId, operation, requestId }) as { response_json?: string } | undefined;
  if (!row) return null;
  return parseJson(row.response_json ?? "null", "Stored idempotency response is invalid") as { entityId?: string; aliasId?: string; sourceId?: string; factId?: string };
}

function storeIdempotentResponse(database: DatabaseSync, values: { projectId: string; operation: string; requestId: string; resourceType: string; resourceId: string; response: unknown }) {
  database.prepare("INSERT INTO idempotency_keys (id, project_id, operation, request_id, resource_type, resource_id, response_json, created_at) VALUES (:id, :projectId, :operation, :requestId, :resourceType, :resourceId, :responseJson, :createdAt)").run({ id: randomUUID(), projectId: values.projectId, operation: values.operation, requestId: values.requestId, resourceType: values.resourceType, resourceId: values.resourceId, responseJson: JSON.stringify(values.response), createdAt: now() });
}

function writeEvent(database: DatabaseSync, values: { projectId: string; eventType: string; aggregateType: string; aggregateId: string; aggregateVersion?: number | null; payload?: Record<string, unknown>; actorId: string; requestId: string }) {
  const createdAt = now();
  const payloadJson = JSON.stringify(values.payload ?? {});
  database.prepare("INSERT INTO audit_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, actor_id, request_id, created_at) VALUES (:id, :projectId, :eventType, :aggregateType, :aggregateId, :aggregateVersion, :payloadJson, :actorId, :requestId, :createdAt)").run({ id: randomUUID(), projectId: values.projectId, eventType: values.eventType, aggregateType: values.aggregateType, aggregateId: values.aggregateId, aggregateVersion: values.aggregateVersion ?? null, payloadJson, actorId: values.actorId, requestId: values.requestId, createdAt });
  database.prepare("INSERT INTO outbox_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, request_id, status, attempts, available_at, published_at, created_at) VALUES (:id, :projectId, :eventType, :aggregateType, :aggregateId, :aggregateVersion, :payloadJson, :requestId, 'pending', 0, :availableAt, NULL, :createdAt)").run({ id: randomUUID(), projectId: values.projectId, eventType: values.eventType, aggregateType: values.aggregateType, aggregateId: values.aggregateId, aggregateVersion: values.aggregateVersion ?? null, payloadJson, requestId: values.requestId, availableAt: createdAt, createdAt });
}

function getEntityRows(database: DatabaseSync, projectId: string) {
  return database.prepare("SELECT id, project_id, entity_type, canonical_name, status, merged_into_entity_id, attributes_json, schema_version, version, created_at, updated_at FROM entities WHERE project_id = :projectId ORDER BY canonical_name COLLATE NOCASE ASC, id ASC").all({ projectId }) as unknown as EntityRow[];
}

function getAliasRows(database: DatabaseSync, entityId: string) {
  return database.prepare("SELECT id, project_id, entity_id, alias, normalized_alias, locale, status, created_at FROM entity_aliases WHERE entity_id = :entityId ORDER BY normalized_alias ASC, id ASC").all({ entityId }) as unknown as EntityAliasRow[];
}

export function listEntities(projectId: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  getProject(db, projectId);
  return getEntityRows(db, projectId).map(toEntity);
}

export function getEntity(entityId: string, database?: DatabaseSync) {
  return getEntityWithDatabase(entityId, resolveDatabase(database));
}

export function getEntityForProject(projectId: string, entityId: string, database?: DatabaseSync) {
  return getEntityInProject(entityId, projectId, resolveDatabase(database));
}

export function listEntityAliases(entityId: string, projectId?: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  const entity = projectId === undefined ? getEntityWithDatabase(entityId, db) : getEntityInProject(entityId, projectId, db);
  if (!entity) throw new StoryBibleNotFoundError("Entity not found");
  return getAliasRows(db, entity.id).map(toAlias);
}

export const listAliases = listEntityAliases;

export function getEntityAlias(aliasId: string, projectId?: string, database?: DatabaseSync) {
  const alias = getAliasWithDatabase(aliasId, resolveDatabase(database));
  if (!alias || (projectId !== undefined && alias.projectId !== projectId)) return null;
  return alias;
}

export function createEntity(projectId: string, input: CreateEntityInput, database?: DatabaseSync) {
  const values = createEntityInputSchema.parse(input);
  const db = resolveDatabase(database);
  getProject(db, projectId);
  const requestId = values.requestId?.trim() || randomUUID();
  const actorId = values.actorId?.trim() || "local-user";
  const duplicate = getIdempotentResponse(db, projectId, "entity.create", requestId);
  if (duplicate?.entityId) return getEntityInProject(duplicate.entityId, projectId, db);
  const entityType = values.entityType ?? values.type;
  if (values.mergedIntoEntityId !== null) {
    const target = getEntityWithDatabase(values.mergedIntoEntityId, db);
    if (!target || target.projectId !== projectId) throw new StoryBibleNotFoundError("Merged target entity not found");
  }

  return withTransaction(db, () => {
    const id = randomUUID();
    const timestamp = now();
    db.prepare("INSERT INTO entities (id, project_id, entity_type, canonical_name, status, merged_into_entity_id, attributes_json, schema_version, version, created_at, updated_at) VALUES (:id, :projectId, :entityType, :canonicalName, :status, :mergedIntoEntityId, :attributesJson, :schemaVersion, 1, :createdAt, :updatedAt)").run({ id, projectId, entityType, canonicalName: values.canonicalName, status: values.status, mergedIntoEntityId: values.mergedIntoEntityId ?? null, attributesJson: JSON.stringify(values.attributes), schemaVersion: values.schemaVersion, createdAt: timestamp, updatedAt: timestamp });
    const entity = getEntityInProject(id, projectId, db);
    storeIdempotentResponse(db, { projectId, operation: "entity.create", requestId, resourceType: "entity", resourceId: id, response: { entityId: id } });
    writeEvent(db, { projectId, eventType: "entity.created", aggregateType: "entity", aggregateId: id, aggregateVersion: entity.version, payload: { type: entity.type, canonicalName: entity.canonicalName }, actorId, requestId });
    return entity;
  });
}

export function updateEntity(entityId: string, input: UpdateEntityInput, database?: DatabaseSync) {
  const values = updateEntityInputSchema.parse(input);
  const db = resolveDatabase(database);
  const current = getEntityWithDatabase(entityId, db);
  if (!current) return null;
  const baseVersion = values.baseVersion ?? values.expectedVersion ?? current.version;
  const requestId = values.requestId?.trim() || randomUUID();
  const actorId = values.actorId?.trim() || "local-user";
  const duplicate = getIdempotentResponse(db, current.projectId, "entity.update", requestId);
  if (duplicate?.entityId) return getEntityInProject(duplicate.entityId, current.projectId, db);
  if (current.version !== baseVersion) throw new StoryBibleConflictError("entity", current);
  if (values.mergedIntoEntityId !== undefined) {
    if (values.mergedIntoEntityId === entityId) throw new StoryBibleValidationError("An entity cannot merge into itself", ["mergedIntoEntityId"]);
    if (values.mergedIntoEntityId !== null) {
      const target = getEntityWithDatabase(values.mergedIntoEntityId, db);
      if (!target || target.projectId !== current.projectId) throw new StoryBibleNotFoundError("Merged target entity not found");
    }
  }

  return withTransaction(db, () => {
    const createsTombstone = (values.status !== undefined && values.status !== "active" && values.status !== "draft")
      || (values.mergedIntoEntityId !== undefined && values.mergedIntoEntityId !== null);
    if (createsTombstone) {
      const confirmedLink = db.prepare("SELECT id FROM scene_entity_links WHERE project_id = :projectId AND entity_id = :entityId AND status = 'confirmed' LIMIT 1").get({ projectId: current.projectId, entityId });
      if (confirmedLink) {
        const latest = getEntityWithDatabase(entityId, db);
        if (latest) throw new StoryBibleConflictError("entity", latest);
      }
    }
    const updatedAt = nextRevisionTimestamp(current.updatedAt);
    const result = db.prepare("UPDATE entities SET canonical_name = COALESCE(:canonicalName, canonical_name), status = COALESCE(:status, status), merged_into_entity_id = CASE WHEN :hasMergedTarget = 1 THEN :mergedIntoEntityId ELSE merged_into_entity_id END, attributes_json = COALESCE(:attributesJson, attributes_json), version = version + 1, updated_at = :updatedAt WHERE id = :entityId AND project_id = :projectId AND version = :baseVersion").run({ entityId, projectId: current.projectId, canonicalName: values.canonicalName ?? null, status: values.status ?? null, hasMergedTarget: values.mergedIntoEntityId === undefined ? 0 : 1, mergedIntoEntityId: values.mergedIntoEntityId ?? null, attributesJson: values.attributes === undefined ? null : JSON.stringify(values.attributes), updatedAt, baseVersion });
    if (result.changes === 0) {
      const latest = getEntityWithDatabase(entityId, db);
      if (latest) throw new StoryBibleConflictError("entity", latest);
      return null;
    }
    const entity = getEntityWithDatabase(entityId, db) as Entity;
    storeIdempotentResponse(db, { projectId: current.projectId, operation: "entity.update", requestId, resourceType: "entity", resourceId: entityId, response: { entityId } });
    writeEvent(db, { projectId: current.projectId, eventType: "entity.updated", aggregateType: "entity", aggregateId: entityId, aggregateVersion: entity.version, payload: { canonicalName: entity.canonicalName, status: entity.status }, actorId, requestId });
    return entity;
  });
}

export const patchEntity = updateEntity;

export function createEntityAlias(entityId: string, input: CreateEntityAliasInput, projectId?: string, database?: DatabaseSync) {
  const values = createEntityAliasInputSchema.parse(input);
  const db = resolveDatabase(database);
  const entity = projectId === undefined ? getEntityWithDatabase(entityId, db) : getEntityInProject(entityId, projectId, db);
  if (!entity) throw new StoryBibleNotFoundError("Entity not found");
  const requestId = values.requestId?.trim() || randomUUID();
  const actorId = values.actorId?.trim() || "local-user";
  const duplicate = getIdempotentResponse(db, entity.projectId, "entity-alias.create", requestId);
  if (duplicate?.aliasId) return getAliasWithDatabase(duplicate.aliasId, db);
  const normalizedAlias = normalizeAlias(values.alias);
  const existing = db.prepare("SELECT id, project_id, entity_id, alias, normalized_alias, locale, status, created_at FROM entity_aliases WHERE project_id = :projectId AND entity_id = :entityId AND normalized_alias = :normalizedAlias").get({ projectId: entity.projectId, entityId, normalizedAlias }) as unknown as EntityAliasRow | undefined;
  if (existing) return toAlias(existing);

  return withTransaction(db, () => {
    const id = randomUUID();
    const createdAt = now();
    db.prepare("INSERT INTO entity_aliases (id, project_id, entity_id, alias, normalized_alias, locale, status, created_at) VALUES (:id, :projectId, :entityId, :alias, :normalizedAlias, :locale, 'active', :createdAt)").run({ id, projectId: entity.projectId, entityId, alias: values.alias, normalizedAlias, locale: values.locale ?? null, createdAt });
    const alias = getAliasWithDatabase(id, db) as EntityAlias;
    storeIdempotentResponse(db, { projectId: entity.projectId, operation: "entity-alias.create", requestId, resourceType: "entity_alias", resourceId: id, response: { aliasId: id } });
    writeEvent(db, { projectId: entity.projectId, eventType: "entity.alias.created", aggregateType: "entity", aggregateId: entityId, aggregateVersion: entity.version, payload: { aliasId: id, normalizedAlias }, actorId, requestId });
    return alias;
  });
}

export function createEntityAliasForProject(projectId: string, entityId: string, input: CreateEntityAliasInput, database?: DatabaseSync) {
  return createEntityAlias(entityId, input, projectId, database);
}

export function listAliasesByProject(projectId: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  getProject(db, projectId);
  return (db.prepare("SELECT id, project_id, entity_id, alias, normalized_alias, locale, status, created_at FROM entity_aliases WHERE project_id = :projectId ORDER BY normalized_alias ASC, id ASC").all({ projectId }) as unknown as EntityAliasRow[]).map(toAlias);
}

function validateSceneReference(database: DatabaseSync, projectId: string, sceneId: string | null | undefined) {
  if (sceneId === null || sceneId === undefined) return;
  const row = database.prepare("SELECT project_id FROM scenes WHERE id = :sceneId").get({ sceneId }) as { project_id?: string } | undefined;
  if (!row || row.project_id !== projectId) throw new StoryBibleNotFoundError("Scene not found");
}

function validateFactScope(database: DatabaseSync, projectId: string, values: { scope: Fact["scope"]; sceneId?: string | null; validFromSceneId?: string | null; validToSceneId?: string | null }) {
  const sceneId = values.sceneId ?? null;
  const validFromSceneId = values.validFromSceneId ?? null;
  const validToSceneId = values.validToSceneId ?? null;
  if (values.scope === "base") {
    if (sceneId !== null || validFromSceneId !== null || validToSceneId !== null) throw new StoryBibleValidationError("Base facts cannot reference a scene", ["scope"]);
    return;
  }
  if (values.scope === "scene") {
    if (sceneId === null || validFromSceneId !== null || validToSceneId !== null) throw new StoryBibleValidationError("Scene facts require only sceneId", ["scope"]);
    return;
  }
  if (sceneId !== null || validFromSceneId === null) throw new StoryBibleValidationError("Range facts require validFromSceneId and no sceneId", ["scope"]);
  const from = database.prepare("SELECT project_id, document_id, narrative_rank FROM scenes WHERE id = :sceneId").get({ sceneId: validFromSceneId }) as { project_id?: string; document_id?: string; narrative_rank?: number } | undefined;
  if (!from || from.project_id !== projectId || !Number.isInteger(from.narrative_rank) || (from.narrative_rank as number) < 0) throw new StoryBibleValidationError("Range start scene is invalid", ["validFromSceneId"]);
  if (validToSceneId !== null) {
    const to = database.prepare("SELECT project_id, document_id, narrative_rank FROM scenes WHERE id = :sceneId").get({ sceneId: validToSceneId }) as { project_id?: string; document_id?: string; narrative_rank?: number } | undefined;
    if (!to || to.project_id !== projectId || to.document_id !== from.document_id || !Number.isInteger(to.narrative_rank) || (to.narrative_rank as number) < (from.narrative_rank as number)) throw new StoryBibleValidationError("Range end scene must be in the same document and not precede its start", ["validToSceneId"]);
  }
}

export type FactScopeInterval =
  | { kind: "base" }
  | { kind: "scene" | "range"; documentId: string; from: number; to: number };

export function factScopeInterval(database: DatabaseSync, projectId: string, values: { scope: Fact["scope"]; sceneId: string | null; validFromSceneId: string | null; validToSceneId: string | null }, path = "fact") : FactScopeInterval {
  if (values.scope === "base") {
    if (values.sceneId !== null || values.validFromSceneId !== null || values.validToSceneId !== null) throw new StoryBibleDataIntegrityError(`${path} base scope contains scene references`);
    return { kind: "base" };
  }
  if (values.scope === "scene") {
    if (values.sceneId === null || values.validFromSceneId !== null || values.validToSceneId !== null) throw new StoryBibleDataIntegrityError(`${path} scene scope shape is invalid`);
    const scene = database.prepare("SELECT project_id, document_id, narrative_rank FROM scenes WHERE id = :sceneId").get({ sceneId: values.sceneId }) as { project_id?: string; document_id?: string; narrative_rank?: number } | undefined;
    if (!scene || scene.project_id !== projectId || !Number.isInteger(scene.narrative_rank) || (scene.narrative_rank as number) < 0) throw new StoryBibleDataIntegrityError(`${path} scene reference is invalid`);
    return { kind: "scene", documentId: scene.document_id as string, from: scene.narrative_rank as number, to: scene.narrative_rank as number };
  }
  if (values.sceneId !== null || values.validFromSceneId === null) throw new StoryBibleDataIntegrityError(`${path} range scope shape is invalid`);
  const from = database.prepare("SELECT project_id, document_id, narrative_rank FROM scenes WHERE id = :sceneId").get({ sceneId: values.validFromSceneId }) as { project_id?: string; document_id?: string; narrative_rank?: number } | undefined;
  if (!from || from.project_id !== projectId || !Number.isInteger(from.narrative_rank) || (from.narrative_rank as number) < 0) throw new StoryBibleDataIntegrityError(`${path} range start is invalid`);
  let toRank = Number.POSITIVE_INFINITY;
  if (values.validToSceneId !== null) {
    const to = database.prepare("SELECT project_id, document_id, narrative_rank FROM scenes WHERE id = :sceneId").get({ sceneId: values.validToSceneId }) as { project_id?: string; document_id?: string; narrative_rank?: number } | undefined;
    if (!to || to.project_id !== projectId || to.document_id !== from.document_id || !Number.isInteger(to.narrative_rank) || (to.narrative_rank as number) < (from.narrative_rank as number)) throw new StoryBibleDataIntegrityError(`${path} range end is invalid`);
    toRank = to.narrative_rank as number;
  }
  return { kind: "range", documentId: from.document_id as string, from: from.narrative_rank as number, to: toRank };
}

export function factScopesOverlap(left: FactScopeInterval, right: FactScopeInterval) {
  if (left.kind === "base" || right.kind === "base") return left.kind === "base" && right.kind === "base";
  if (left.documentId !== right.documentId) return false;
  return left.from <= right.to && right.from <= left.to;
}

function validateEvidenceReferences(database: DatabaseSync, projectId: string, values: CreateEvidenceSourceInput) {
  if (values.documentId) {
    const row = database.prepare("SELECT project_id FROM script_documents WHERE id = :documentId").get({ documentId: values.documentId }) as { project_id?: string } | undefined;
    if (!row || row.project_id !== projectId) throw new StoryBibleNotFoundError("Document not found");
  }
  validateSceneReference(database, projectId, values.sceneId);
  const sceneRevisionId = values.sceneRevisionId ?? values.revisionId ?? null;
  let resolvedDocumentId = values.documentId ?? null;
  let resolvedSceneId = values.sceneId ?? null;
  if (sceneRevisionId) {
    const row = database.prepare("SELECT project_id, document_id, scene_id FROM scene_revisions WHERE id = :sceneRevisionId").get({ sceneRevisionId }) as { project_id?: string; document_id?: string; scene_id?: string } | undefined;
    if (!row || row.project_id !== projectId) throw new StoryBibleNotFoundError("Scene revision not found");
    if (values.sceneId && row.scene_id !== values.sceneId) throw new StoryBibleValidationError("sceneId must match sceneRevisionId", ["sceneId"]);
    if (values.documentId && row.document_id !== values.documentId) throw new StoryBibleValidationError("documentId must match sceneRevisionId", ["documentId"]);
    resolvedDocumentId = row.document_id ?? null;
    resolvedSceneId = row.scene_id ?? null;
  }
  return { documentId: resolvedDocumentId, sceneId: resolvedSceneId, sceneRevisionId };
}

export function listEvidenceSources(projectId: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  getProject(db, projectId);
  return (db.prepare("SELECT id, project_id, kind, document_id, scene_id, scene_revision_id, anchor_start, anchor_end, quoted_text, created_by_user_id, model_run_id, created_at FROM evidence_sources WHERE project_id = :projectId ORDER BY created_at DESC, id DESC").all({ projectId }) as unknown as EvidenceSourceRow[]).map(toEvidenceSource);
}

export function getEvidenceSource(sourceId: string, projectId?: string, database?: DatabaseSync) {
  const source = getEvidenceWithDatabase(sourceId, resolveDatabase(database));
  if (!source || (projectId !== undefined && source.projectId !== projectId)) return null;
  return source;
}

export function createEvidenceSource(projectId: string, input: CreateEvidenceSourceInput, database?: DatabaseSync): EvidenceSource {
  const values = createEvidenceSourceInputSchema.parse(input);
  const db = resolveDatabase(database);
  getProject(db, projectId);
  const references = validateEvidenceReferences(db, projectId, values);
  const requestId = values.requestId?.trim() || randomUUID();
  const actorId = values.actorId?.trim() || "local-user";
  const duplicate = getIdempotentResponse(db, projectId, "evidence-source.create", requestId);
  if (duplicate?.sourceId) {
    const existing = getEvidenceWithDatabase(duplicate.sourceId, db);
    if (!existing) throw new StoryBibleDataIntegrityError("Idempotent evidence source is missing");
    return existing;
  }

  return withTransaction(db, () => {
    const id = randomUUID();
    const createdAt = now();
    db.prepare("INSERT INTO evidence_sources (id, project_id, kind, document_id, scene_id, scene_revision_id, revision_id, anchor_start, anchor_end, quoted_text, created_by_user_id, model_run_id, created_at) VALUES (:id, :projectId, :kind, :documentId, :sceneId, :sceneRevisionId, :revisionId, :anchorStart, :anchorEnd, :quotedText, :createdByUserId, :modelRunId, :createdAt)").run({ id, projectId, kind: values.kind, documentId: references.documentId, sceneId: references.sceneId, sceneRevisionId: references.sceneRevisionId, revisionId: references.sceneRevisionId, anchorStart: values.anchorStart ?? null, anchorEnd: values.anchorEnd ?? null, quotedText: values.quotedText ?? null, createdByUserId: values.createdByUserId ?? null, modelRunId: values.modelRunId ?? null, createdAt });
    const source = getEvidenceWithDatabase(id, db) as EvidenceSource;
    storeIdempotentResponse(db, { projectId, operation: "evidence-source.create", requestId, resourceType: "evidence_source", resourceId: id, response: { sourceId: id } });
    writeEvent(db, { projectId, eventType: "evidence_source.created", aggregateType: "evidence_source", aggregateId: id, payload: { kind: source.kind, sceneRevisionId: source.sceneRevisionId }, actorId, requestId });
    return source;
  });
}

function validateFactReferences(database: DatabaseSync, projectId: string, values: { subjectEntityId: string; sourceId: string; scope: Fact["scope"]; sceneId?: string | null; validFromSceneId?: string | null; validToSceneId?: string | null; supersedesFactId?: string | null }) {
  const entity = getEntityWithDatabase(values.subjectEntityId, database);
  if (!entity || entity.projectId !== projectId) throw new StoryBibleNotFoundError("Subject entity not found");
  const source = getEvidenceWithDatabase(values.sourceId, database);
  if (!source || source.projectId !== projectId) throw new StoryBibleNotFoundError("Evidence source not found");
  validateSceneReference(database, projectId, values.sceneId);
  validateSceneReference(database, projectId, values.validFromSceneId);
  validateSceneReference(database, projectId, values.validToSceneId);
  validateFactScope(database, projectId, values);
  if (values.supersedesFactId) {
    const previous = getFactWithDatabase(values.supersedesFactId, database);
    if (!previous || previous.projectId !== projectId) throw new StoryBibleNotFoundError("Fact to supersede not found");
  }
  return entity;
}

function assertFactSchema(values: CreateFactInput, entity: Entity, database: DatabaseSync, projectId: string) {
  const validation = validatePredicateValue({ predicate: values.predicate, value: values.value, valueType: values.valueType, scope: values.scope, entityType: entity.type });
  if (!validation.ok) throw new StoryBibleValidationError(validation.message, ["predicate"]);
  if (values.scope === "base" && (values.sceneId || values.validFromSceneId || values.validToSceneId)) throw new StoryBibleValidationError("Base facts cannot reference a scene", ["scope"]);
  if (values.scope !== "base" && !values.sceneId && !values.validFromSceneId) throw new StoryBibleValidationError("Scene and range facts require a scene reference", ["sceneId"]);
  const definition = getPredicateDefinition(values.predicate);
  if (!definition) throw new StoryBibleValidationError("Unknown predicate", ["predicate"]);
  if (values.valueType === "entity_ref") {
    const referencedEntityId = typeof values.value === "string" ? values.value : "";
    const referencedEntity = referencedEntityId ? getEntityWithDatabase(referencedEntityId, database) : null;
    if (!referencedEntity || referencedEntity.projectId !== projectId || referencedEntity.status === "archived" || referencedEntity.status === "merged" || referencedEntity.mergedIntoEntityId !== null) {
      throw new StoryBibleValidationError("Entity reference must point to an active entity in the same project", ["value"]);
    }
  }
  return definition;
}

export function listFacts(projectId: string, options: { subjectEntityId?: string; predicate?: string; status?: Fact["status"] } = {}, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  getProject(db, projectId);
  if (options.subjectEntityId) {
    const entity = getEntityWithDatabase(options.subjectEntityId, db);
    if (!entity || entity.projectId !== projectId) throw new StoryBibleNotFoundError("Subject entity not found");
  }
  const conditions = ["project_id = :projectId"];
  const parameters: SqliteParameters = { projectId };
  if (options.subjectEntityId) { conditions.push("subject_entity_id = :subjectEntityId"); parameters.subjectEntityId = options.subjectEntityId; }
  if (options.predicate) { conditions.push("predicate = :predicate"); parameters.predicate = options.predicate; }
  if (options.status) { conditions.push("status = :status"); parameters.status = options.status; }
  const rows = db.prepare(`SELECT id, project_id, subject_entity_id, predicate, value_json, value_type, truth_class, scope, scene_id, valid_from_scene_id, valid_to_scene_id, source_id, promoted_from_inference_id, status, supersedes_fact_id, version, created_at FROM facts WHERE ${conditions.join(" AND ")} ORDER BY created_at ASC, id ASC`).all(parameters) as unknown as FactRow[];
  return rows.map(toFact);
}

export function getFact(factId: string, projectId?: string, database?: DatabaseSync) {
  const fact = getFactWithDatabase(factId, resolveDatabase(database));
  if (!fact || (projectId !== undefined && fact.projectId !== projectId)) return null;
  return fact;
}

export function createFact(projectId: string, input: CreateFactInput, database?: DatabaseSync): Fact {
  const values = createFactInputSchema.parse(input);
  const db = resolveDatabase(database);
  getProject(db, projectId);
  const entity = validateFactReferences(db, projectId, values);
  const definition = assertFactSchema(values, entity, db, projectId);
  const requestId = values.requestId?.trim() || randomUUID();
  const actorId = values.actorId?.trim() || "local-user";
  const duplicate = getIdempotentResponse(db, projectId, "fact.create", requestId);
  if (duplicate?.factId) {
    const existing = getFactWithDatabase(duplicate.factId, db);
    if (!existing) throw new StoryBibleDataIntegrityError("Idempotent fact is missing");
    return existing;
  }
  const expectedVersion = values.baseVersion ?? values.expectedVersion;

  return withTransaction(db, () => {
    let previous: Fact | null = null;
    if (values.supersedesFactId) {
      previous = getFactWithDatabase(values.supersedesFactId, db);
      if (!previous || previous.projectId !== projectId) throw new StoryBibleNotFoundError("Fact to supersede not found");
      if (previous.status !== "active") throw new StoryBibleValidationError("Only an active fact can be superseded", ["supersedesFactId"]);
      if (expectedVersion !== undefined && previous.version !== expectedVersion) throw new StoryBibleConflictError("fact", previous);
      if (previous.subjectEntityId !== values.subjectEntityId || previous.predicate !== values.predicate || previous.scope !== values.scope) throw new StoryBibleValidationError("Superseded fact must have the same subject, predicate, and scope", ["supersedesFactId"]);
    } else if (definition.cardinality === "single") {
      const candidateScope = factScopeInterval(db, projectId, { scope: values.scope, sceneId: values.sceneId ?? null, validFromSceneId: values.validFromSceneId ?? null, validToSceneId: values.validToSceneId ?? null }, "new fact");
      const activeRows = db.prepare("SELECT id, scope, scene_id, valid_from_scene_id, valid_to_scene_id FROM facts WHERE project_id = :projectId AND subject_entity_id = :subjectEntityId AND predicate = :predicate AND status = 'active'").all({ projectId, subjectEntityId: values.subjectEntityId, predicate: values.predicate }) as Array<{ id: string; scope: Fact["scope"]; scene_id: string | null; valid_from_scene_id: string | null; valid_to_scene_id: string | null }>;
      const active = activeRows.find((row) => factScopesOverlap(candidateScope, factScopeInterval(db, projectId, { scope: row.scope, sceneId: row.scene_id, validFromSceneId: row.valid_from_scene_id, validToSceneId: row.valid_to_scene_id }, `existing fact ${row.id}`)));
      if (active) throw new StoryBibleValidationError("An active fact already occupies an overlapping scope; supersede it instead of overwriting it", ["supersedesFactId"]);
    }
    if (previous) {
      db.prepare("UPDATE facts SET status = 'superseded', version = version + 1 WHERE id = :factId AND project_id = :projectId AND status = 'active'").run({ factId: previous.id, projectId });
    }
    const id = randomUUID();
    const createdAt = now();
    db.prepare("INSERT INTO facts (id, project_id, subject_entity_id, predicate, value_json, value_type, truth_class, scope, scene_id, valid_from_scene_id, valid_to_scene_id, source_id, status, supersedes_fact_id, version, created_at) VALUES (:id, :projectId, :subjectEntityId, :predicate, :valueJson, :valueType, 'canon', :scope, :sceneId, :validFromSceneId, :validToSceneId, :sourceId, 'active', :supersedesFactId, 1, :createdAt)").run({ id, projectId, subjectEntityId: values.subjectEntityId, predicate: values.predicate, valueJson: JSON.stringify(values.value), valueType: values.valueType, scope: values.scope, sceneId: values.sceneId ?? null, validFromSceneId: values.validFromSceneId ?? null, validToSceneId: values.validToSceneId ?? null, sourceId: values.sourceId, supersedesFactId: values.supersedesFactId ?? null, createdAt });
    const fact = getFactWithDatabase(id, db) as Fact;
    storeIdempotentResponse(db, { projectId, operation: "fact.create", requestId, resourceType: "fact", resourceId: id, response: { factId: id } });
    writeEvent(db, { projectId, eventType: "fact.created", aggregateType: "fact", aggregateId: id, aggregateVersion: fact.version, payload: { subjectEntityId: fact.subjectEntityId, predicate: fact.predicate, supersedesFactId: fact.supersedesFactId }, actorId, requestId });
    if (previous) writeEvent(db, { projectId, eventType: "fact.superseded", aggregateType: "fact", aggregateId: previous.id, aggregateVersion: previous.version, payload: { supersededByFactId: id }, actorId, requestId });
    return fact;
  });
}

export function supersedeFact(factId: string, input: SupersedeFactInput, database?: DatabaseSync) {
  const values = supersedeFactInputSchema.parse(input);
  const db = resolveDatabase(database);
  const previous = getFactWithDatabase(factId, db);
  if (!previous) return null;
  const result = createFact(previous.projectId, { subjectEntityId: previous.subjectEntityId, predicate: previous.predicate, value: values.value, valueType: values.valueType, scope: values.scope ?? previous.scope, sceneId: values.sceneId ?? previous.sceneId, validFromSceneId: values.validFromSceneId ?? previous.validFromSceneId, validToSceneId: values.validToSceneId ?? previous.validToSceneId, sourceId: values.sourceId, supersedesFactId: factId, baseVersion: values.baseVersion ?? values.expectedVersion, requestId: values.requestId, actorId: values.actorId }, db);
  return result;
}

export const replaceFact = supersedeFact;

export function retractFact(factId: string, input: RetractFactInput = {}, database?: DatabaseSync) {
  const values = retractFactInputSchema.parse(input);
  const db = resolveDatabase(database);
  const current = getFactWithDatabase(factId, db);
  if (!current) return null;
  const requestId = values.requestId?.trim() || randomUUID();
  const actorId = values.actorId?.trim() || "local-user";
  const duplicate = getIdempotentResponse(db, current.projectId, "fact.retract", requestId);
  if (duplicate?.factId) return getFactWithDatabase(duplicate.factId, db);
  const expectedVersion = values.baseVersion ?? values.expectedVersion;
  if (expectedVersion !== undefined && expectedVersion !== current.version) throw new StoryBibleConflictError("fact", current);
  if (current.status !== "active") throw new StoryBibleValidationError("Only an active fact can be retracted", ["factId"]);

  return withTransaction(db, () => {
    const result = db.prepare("UPDATE facts SET status = 'retracted', version = version + 1 WHERE id = :factId AND project_id = :projectId AND status = 'active'").run({ factId, projectId: current.projectId });
    if (result.changes === 0) {
      const latest = getFactWithDatabase(factId, db);
      if (latest) throw new StoryBibleConflictError("fact", latest);
      return null;
    }
    const fact = getFactWithDatabase(factId, db) as Fact;
    storeIdempotentResponse(db, { projectId: current.projectId, operation: "fact.retract", requestId, resourceType: "fact", resourceId: factId, response: { factId } });
    writeEvent(db, { projectId: current.projectId, eventType: "fact.retracted", aggregateType: "fact", aggregateId: factId, aggregateVersion: fact.version, payload: {}, actorId, requestId });
    return fact;
  });
}

export const retractFactValue = retractFact;

function toAuditEvent(row: Record<string, unknown>): AuditEvent {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    eventType: String(row.event_type),
    aggregateType: String(row.aggregate_type),
    aggregateId: String(row.aggregate_id),
    aggregateVersion: row.aggregate_version === null || row.aggregate_version === undefined ? null : Number(row.aggregate_version),
    payload: parseJson(String(row.payload_json ?? "{}"), "Invalid audit payload") as Record<string, unknown>,
    actorId: String(row.actor_id),
    requestId: String(row.request_id),
    createdAt: String(row.created_at),
  };
}

function toOutboxEvent(row: Record<string, unknown>): OutboxEvent {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    eventType: String(row.event_type),
    aggregateType: String(row.aggregate_type),
    aggregateId: String(row.aggregate_id),
    aggregateVersion: row.aggregate_version === null || row.aggregate_version === undefined ? null : Number(row.aggregate_version),
    payload: parseJson(String(row.payload_json ?? "{}"), "Invalid outbox payload") as Record<string, unknown>,
    requestId: String(row.request_id),
    status: row.status as OutboxEvent["status"],
    attempts: Number(row.attempts),
    availableAt: String(row.available_at),
    publishedAt: row.published_at === null || row.published_at === undefined ? null : String(row.published_at),
    createdAt: String(row.created_at),
  };
}

export function listAuditEvents(projectId: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  getProject(db, projectId);
  const rows = db.prepare("SELECT id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, actor_id, request_id, created_at FROM audit_events WHERE project_id = :projectId ORDER BY created_at DESC, id DESC").all({ projectId }) as unknown as Array<Record<string, unknown>>;
  return rows.map(toAuditEvent);
}

export function listOutboxEvents(projectId: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  getProject(db, projectId);
  const rows = db.prepare("SELECT id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, request_id, status, attempts, available_at, published_at, created_at FROM outbox_events WHERE project_id = :projectId ORDER BY created_at DESC, id DESC").all({ projectId }) as unknown as Array<Record<string, unknown>>;
  return rows.map(toOutboxEvent);
}

export function listPendingOutboxEvents(projectId: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  getProject(db, projectId);
  const rows = db.prepare("SELECT id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, request_id, status, attempts, available_at, published_at, created_at FROM outbox_events WHERE project_id = :projectId AND status = 'pending' ORDER BY available_at ASC, created_at ASC, id ASC").all({ projectId }) as unknown as Array<Record<string, unknown>>;
  return rows.map(toOutboxEvent);
}

export function createStoryBibleRepository(database: DatabaseSync = getDatabase()) {
  return {
    listEntities: (projectId: string) => listEntities(projectId, database),
    getEntity: (entityId: string) => getEntity(entityId, database),
    getEntityForProject: (projectId: string, entityId: string) => getEntityForProject(projectId, entityId, database),
    createEntity: (projectId: string, input: CreateEntityInput) => createEntity(projectId, input, database),
    updateEntity: (entityId: string, input: UpdateEntityInput) => updateEntity(entityId, input, database),
    patchEntity: (entityId: string, input: UpdateEntityInput) => updateEntity(entityId, input, database),
    listEntityAliases: (entityId: string, projectId?: string) => listEntityAliases(entityId, projectId, database),
    listAliases: (entityId: string, projectId?: string) => listEntityAliases(entityId, projectId, database),
    getEntityAlias: (aliasId: string, projectId?: string) => getEntityAlias(aliasId, projectId, database),
    createEntityAlias: (entityId: string, input: CreateEntityAliasInput, projectId?: string) => createEntityAlias(entityId, input, projectId, database),
    createEntityAliasForProject: (projectId: string, entityId: string, input: CreateEntityAliasInput) => createEntityAliasForProject(projectId, entityId, input, database),
    listAliasesByProject: (projectId: string) => listAliasesByProject(projectId, database),
    listEvidenceSources: (projectId: string) => listEvidenceSources(projectId, database),
    getEvidenceSource: (sourceId: string, projectId?: string) => getEvidenceSource(sourceId, projectId, database),
    createEvidenceSource: (projectId: string, input: CreateEvidenceSourceInput) => createEvidenceSource(projectId, input, database),
    listFacts: (projectId: string, options?: { subjectEntityId?: string; predicate?: string; status?: Fact["status"] }) => listFacts(projectId, options, database),
    getFact: (factId: string, projectId?: string) => getFact(factId, projectId, database),
    createFact: (projectId: string, input: CreateFactInput) => createFact(projectId, input, database),
    supersedeFact: (factId: string, input: SupersedeFactInput) => supersedeFact(factId, input, database),
    replaceFact: (factId: string, input: SupersedeFactInput) => supersedeFact(factId, input, database),
    retractFact: (factId: string, input?: RetractFactInput) => retractFact(factId, input, database),
    listAuditEvents: (projectId: string) => listAuditEvents(projectId, database),
    listOutboxEvents: (projectId: string) => listOutboxEvents(projectId, database),
    listPendingOutboxEvents: (projectId: string) => listPendingOutboxEvents(projectId, database),
  };
}
