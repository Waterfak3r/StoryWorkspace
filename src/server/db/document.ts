import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  canonicalDocumentScenes,
  createDocumentRevisionInputSchema,
  createScriptDocumentInputSchema,
  documentRevisionSchema,
  sceneRevisionSchema,
  sceneSchema,
  scriptDocumentSchema,
  updateScriptDocumentInputSchema,
  type CreateDocumentRevisionInput,
  type CreateScriptDocumentInput,
  type DocumentRevision,
  type RevisionSceneInput,
  type Scene,
  type SceneRevision,
  type ScriptDocument,
  type UpdateScriptDocumentInput,
} from "@/domain/document";
import {
  continuityGroupSchema,
  createContinuityGroupInputSchema,
  type ContinuityGroup,
  type CreateContinuityGroupInput,
} from "@/domain/scene-state";
import { getDatabase } from "./connection";
import { revalidateSceneFactPatches } from "./canon-patch";
import {
  StoryBibleConflictError,
  StoryBibleDataIntegrityError,
  StoryBibleIdempotencyConflictError,
  StoryBibleNotFoundError,
  StoryBibleValidationError,
} from "./story-bible-errors";

type ScriptDocumentRow = {
  id: string;
  project_id: string;
  title: string;
  kind: ScriptDocument["kind"];
  status: ScriptDocument["status"];
  version: number;
  current_revision_id: string | null;
  created_at: string;
  updated_at: string;
};

type SceneRow = {
  id: string;
  project_id: string;
  document_id: string;
  continuity_group_id: string;
  narrative_rank: number;
  status: Scene["status"];
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type DocumentRevisionRow = {
  id: string;
  project_id: string;
  document_id: string;
  revision_number: number;
  base_version: number;
  content_hash: string;
  created_by: string;
  request_id: string;
  created_at: string;
};

type SceneRevisionRow = {
  id: string;
  project_id: string;
  document_id: string;
  scene_id: string;
  continuity_group_id: string;
  document_revision_id: string;
  narrative_rank: number;
  title: string;
  content: string;
  content_hash: string;
  status: SceneRevision["status"];
  created_at: string;
};

type ProjectRow = { id: string };
type ContinuityGroupRow = {
  id: string;
  project_id: string;
  document_id: string;
  name: string;
  kind: ContinuityGroup["kind"];
  is_default: number;
  version: number;
  created_at: string;
  updated_at: string;
};

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

function hashValue(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function toScriptDocument(row: ScriptDocumentRow): ScriptDocument {
  return scriptDocumentSchema.parse({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    kind: row.kind,
    status: row.status,
    version: row.version,
    currentRevisionId: row.current_revision_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toScene(row: SceneRow): Scene {
  return sceneSchema.parse({
    id: row.id,
    projectId: row.project_id,
    documentId: row.document_id,
    continuityGroupId: row.continuity_group_id,
    narrativeRank: row.narrative_rank,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  });
}

function toSceneRevision(row: SceneRevisionRow): SceneRevision {
  return sceneRevisionSchema.parse({
    id: row.id,
    projectId: row.project_id,
    documentId: row.document_id,
    sceneId: row.scene_id,
    continuityGroupId: row.continuity_group_id,
    documentRevisionId: row.document_revision_id,
    narrativeRank: row.narrative_rank,
    title: row.title,
    content: row.content,
    contentHash: row.content_hash,
    status: row.status,
    createdAt: row.created_at,
  });
}

function getProject(database: DatabaseSync, projectId: string) {
  const row = database.prepare("SELECT id FROM projects WHERE id = :projectId").get({ projectId }) as unknown as ProjectRow | undefined;
  if (!row) throw new StoryBibleNotFoundError("Project not found");
}

function toContinuityGroup(row: ContinuityGroupRow): ContinuityGroup {
  return continuityGroupSchema.parse({
    id: row.id,
    projectId: row.project_id,
    documentId: row.document_id,
    name: row.name,
    kind: row.kind,
    isDefault: row.is_default === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function getDefaultContinuityGroup(database: DatabaseSync, projectId: string, documentId: string) {
  const row = database.prepare(
    "SELECT id, project_id, document_id, name, kind, is_default, version, created_at, updated_at FROM continuity_groups WHERE project_id = :projectId AND document_id = :documentId AND is_default = 1 LIMIT 1",
  ).get({ projectId, documentId }) as unknown as ContinuityGroupRow | undefined;
  if (!row) throw new StoryBibleDataIntegrityError("Document default continuity group is missing");
  return toContinuityGroup(row);
}

function getContinuityGroupForDocument(database: DatabaseSync, projectId: string, documentId: string, groupId: string) {
  const row = database.prepare(
    "SELECT id, project_id, document_id, name, kind, is_default, version, created_at, updated_at FROM continuity_groups WHERE id = :groupId AND project_id = :projectId AND document_id = :documentId",
  ).get({ groupId, projectId, documentId }) as unknown as ContinuityGroupRow | undefined;
  if (!row) throw new StoryBibleValidationError("Continuity group must belong to the same project and document", ["scenes"]);
  return toContinuityGroup(row);
}

function getDocumentWithDatabase(documentId: string, database: DatabaseSync) {
  const row = database.prepare(
    "SELECT id, project_id, title, kind, status, version, current_revision_id, created_at, updated_at FROM script_documents WHERE id = :documentId",
  ).get({ documentId }) as unknown as ScriptDocumentRow | undefined;
  return row ? toScriptDocument(row) : null;
}

function getDocumentInProject(documentId: string, projectId: string, database: DatabaseSync) {
  const document = getDocumentWithDatabase(documentId, database);
  if (!document || document.projectId !== projectId) throw new StoryBibleNotFoundError("Document not found");
  return document;
}

function getSceneRow(sceneId: string, database: DatabaseSync) {
  return database.prepare(
    "SELECT id, project_id, document_id, continuity_group_id, narrative_rank, status, version, created_at, updated_at, deleted_at FROM scenes WHERE id = :sceneId",
  ).get({ sceneId }) as unknown as SceneRow | undefined;
}

function listSceneRows(documentId: string, database: DatabaseSync) {
  return database.prepare(
    "SELECT id, project_id, document_id, continuity_group_id, narrative_rank, status, version, created_at, updated_at, deleted_at FROM scenes WHERE document_id = :documentId ORDER BY narrative_rank ASC, id ASC",
  ).all({ documentId }) as unknown as SceneRow[];
}

function listSceneRevisionRows(documentRevisionId: string, database: DatabaseSync) {
  return database.prepare(
    "SELECT id, project_id, document_id, scene_id, continuity_group_id, document_revision_id, narrative_rank, title, content, content_hash, status, created_at FROM scene_revisions WHERE document_revision_id = :documentRevisionId ORDER BY narrative_rank ASC, scene_id ASC",
  ).all({ documentRevisionId }) as unknown as SceneRevisionRow[];
}

function getIdempotentResponse(database: DatabaseSync, projectId: string, operation: string, requestId: string) {
  const row = database.prepare(
    "SELECT response_json FROM idempotency_keys WHERE project_id = :projectId AND operation = :operation AND request_id = :requestId",
  ).get({ projectId, operation, requestId }) as { response_json?: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.response_json ?? "null") as { documentId?: string; revisionId?: string; groupId?: string; inputFingerprint?: string };
  } catch {
    throw new StoryBibleDataIntegrityError("Stored idempotency response is invalid");
  }
}

export function listContinuityGroups(documentId: string, projectId: string, database?: DatabaseSync): ContinuityGroup[] {
  const db = resolveDatabase(database);
  getDocumentInProject(documentId, projectId, db);
  const rows = db.prepare(
    "SELECT id, project_id, document_id, name, kind, is_default, version, created_at, updated_at FROM continuity_groups WHERE project_id = :projectId AND document_id = :documentId ORDER BY is_default DESC, created_at ASC, id ASC",
  ).all({ projectId, documentId }) as unknown as ContinuityGroupRow[];
  return rows.map(toContinuityGroup);
}

export type ContinuityGroupCommandResult = { continuityGroup: ContinuityGroup; idempotent: boolean };

export function createContinuityGroup(projectId: string, documentId: string, input: CreateContinuityGroupInput, database?: DatabaseSync): ContinuityGroupCommandResult {
  const values = createContinuityGroupInputSchema.parse(input);
  const db = resolveDatabase(database);
  getDocumentInProject(documentId, projectId, db);
  const requestId = values.requestId.trim();
  const actorId = values.actorId.trim();
  const inputFingerprint = hashValue({ projectId, documentId, name: values.name, kind: values.kind, actorId });
  return withTransaction(db, () => {
    const duplicate = getIdempotentResponse(db, projectId, "continuity-group.create", requestId);
    if (duplicate?.groupId) {
      if (duplicate.inputFingerprint && duplicate.inputFingerprint !== inputFingerprint) throw new StoryBibleIdempotencyConflictError("This request ID was already used for a different continuity group");
      const existing = db.prepare("SELECT id, project_id, document_id, name, kind, is_default, version, created_at, updated_at FROM continuity_groups WHERE id = :groupId AND project_id = :projectId AND document_id = :documentId").get({ groupId: duplicate.groupId, projectId, documentId }) as unknown as ContinuityGroupRow | undefined;
      if (!existing) throw new StoryBibleDataIntegrityError("Idempotent continuity group is missing");
      return { continuityGroup: toContinuityGroup(existing), idempotent: true };
    }
    const id = randomUUID();
    const createdAt = now();
    db.prepare("INSERT INTO continuity_groups (id, project_id, document_id, name, kind, is_default, version, created_at, updated_at) VALUES (:id, :projectId, :documentId, :name, :kind, 0, 1, :createdAt, :updatedAt)").run({ id, projectId, documentId, name: values.name, kind: values.kind, createdAt, updatedAt: createdAt });
    const row = db.prepare("SELECT id, project_id, document_id, name, kind, is_default, version, created_at, updated_at FROM continuity_groups WHERE id = :id").get({ id }) as unknown as ContinuityGroupRow | undefined;
    if (!row) throw new StoryBibleDataIntegrityError("Continuity group could not be read after insertion");
    const group = toContinuityGroup(row);
    storeIdempotentResponse(db, { projectId, operation: "continuity-group.create", requestId, resourceType: "continuity_group", resourceId: id, response: { groupId: id, inputFingerprint } });
    writeEvent(db, { projectId, eventType: "continuity_group.created", aggregateType: "continuity_group", aggregateId: id, aggregateVersion: group.version, payload: { documentId, kind: group.kind }, actorId, requestId });
    return { continuityGroup: group, idempotent: false };
  });
}

function storeIdempotentResponse(database: DatabaseSync, values: { projectId: string; operation: string; requestId: string; resourceType: string; resourceId: string; response: unknown }) {
  database.prepare(
    "INSERT INTO idempotency_keys (id, project_id, operation, request_id, resource_type, resource_id, response_json, created_at) VALUES (:id, :projectId, :operation, :requestId, :resourceType, :resourceId, :responseJson, :createdAt)",
  ).run({
    id: randomUUID(),
    projectId: values.projectId,
    operation: values.operation,
    requestId: values.requestId,
    resourceType: values.resourceType,
    resourceId: values.resourceId,
    responseJson: JSON.stringify(values.response),
    createdAt: now(),
  });
}

function writeEvent(database: DatabaseSync, values: {
  projectId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion?: number | null;
  payload?: Record<string, unknown>;
  actorId: string;
  requestId: string;
}) {
  const id = randomUUID();
  const createdAt = now();
  const payloadJson = JSON.stringify(values.payload ?? {});
  database.prepare(
    "INSERT INTO audit_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, actor_id, request_id, created_at) VALUES (:id, :projectId, :eventType, :aggregateType, :aggregateId, :aggregateVersion, :payloadJson, :actorId, :requestId, :createdAt)",
  ).run({ id, projectId: values.projectId, eventType: values.eventType, aggregateType: values.aggregateType, aggregateId: values.aggregateId, aggregateVersion: values.aggregateVersion ?? null, payloadJson, actorId: values.actorId, requestId: values.requestId, createdAt });
  database.prepare(
    "INSERT INTO outbox_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, request_id, status, attempts, available_at, published_at, created_at) VALUES (:id, :projectId, :eventType, :aggregateType, :aggregateId, :aggregateVersion, :payloadJson, :requestId, 'pending', 0, :availableAt, NULL, :createdAt)",
  ).run({ id: randomUUID(), projectId: values.projectId, eventType: values.eventType, aggregateType: values.aggregateType, aggregateId: values.aggregateId, aggregateVersion: values.aggregateVersion ?? null, payloadJson, requestId: values.requestId, availableAt: createdAt, createdAt });
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

function revisionSceneRows(documentId: string, projectId: string, scenes: RevisionSceneInput[], database: DatabaseSync) {
  const existing = listSceneRows(documentId, database);
  const existingById = new Map(existing.map((row) => [row.id, row]));
  const seen = new Set<string>();
  const defaultGroup = getDefaultContinuityGroup(database, projectId, documentId);
  const rows: Array<{ sceneId: string; continuityGroupId: string; narrativeRank: number; title: string; content: string; status: Scene["status"] }> = [];

  scenes.forEach((scene, index) => {
    const sceneId = scene.id ?? scene.sceneId ?? randomUUID();
    if (seen.has(sceneId)) throw new StoryBibleValidationError("Scene IDs must be unique within a revision", ["scenes"]);
    seen.add(sceneId);
    const previous = existingById.get(sceneId);
    if (scene.id && (!previous || previous.project_id !== projectId || previous.document_id !== documentId)) {
      throw new StoryBibleValidationError("Scene does not belong to this document", ["scenes"]);
    }
    const latest = database.prepare(
      "SELECT continuity_group_id FROM scene_revisions WHERE scene_id = :sceneId ORDER BY created_at DESC, id DESC LIMIT 1",
    ).get({ sceneId }) as { continuity_group_id?: string } | undefined;
    const continuityGroupId = scene.continuityGroupId ?? latest?.continuity_group_id ?? defaultGroup.id;
    getContinuityGroupForDocument(database, projectId, documentId, continuityGroupId);
    rows.push({
      sceneId,
      continuityGroupId,
      narrativeRank: scene.narrativeRank ?? index,
      title: scene.title,
      content: scene.content,
      status: scene.status ?? "active",
    });
  });

  const ranks = rows.map((row) => row.narrativeRank);
  if (new Set(ranks).size !== ranks.length) throw new StoryBibleValidationError("Scene narrative ranks must be unique", ["scenes"]);

  for (const previous of existing) {
    if (seen.has(previous.id)) continue;
    const latest = database.prepare(
      "SELECT title, content, continuity_group_id FROM scene_revisions WHERE scene_id = :sceneId ORDER BY created_at DESC, id DESC LIMIT 1",
    ).get({ sceneId: previous.id }) as { title?: string; content?: string; continuity_group_id?: string } | undefined;
    rows.push({
      sceneId: previous.id,
      continuityGroupId: latest?.continuity_group_id ?? defaultGroup.id,
      narrativeRank: previous.narrative_rank,
      title: latest?.title ?? "",
      content: latest?.content ?? "",
      status: "deleted",
    });
  }
  return rows.sort((left, right) => left.narrativeRank - right.narrativeRank || left.sceneId.localeCompare(right.sceneId));
}

function getDocumentRevisionWithDatabase(revisionId: string, database: DatabaseSync) {
  const row = database.prepare(
    "SELECT id, project_id, document_id, revision_number, base_version, content_hash, created_by, request_id, created_at FROM document_revisions WHERE id = :revisionId",
  ).get({ revisionId }) as unknown as DocumentRevisionRow | undefined;
  if (!row) return null;
  const sceneRevisions = listSceneRevisionRows(row.id, database).map(toSceneRevision);
  return documentRevisionSchema.parse({
    id: row.id,
    projectId: row.project_id,
    documentId: row.document_id,
    revisionNumber: row.revision_number,
    baseVersion: row.base_version,
    contentHash: row.content_hash,
    createdBy: row.created_by,
    requestId: row.request_id,
    createdAt: row.created_at,
    sceneRevisions,
  });
}

function insertDocumentRevision(database: DatabaseSync, document: ScriptDocument, values: {
  baseVersion: number;
  requestId: string;
  actorId: string;
  scenes: RevisionSceneInput[];
}) {
  const rows = revisionSceneRows(document.id, document.projectId, values.scenes, database);
  const revisionId = randomUUID();
  const revisionNumber = document.version + 1;
  const canonicalScenes = canonicalDocumentScenes(rows.map((row) => ({ ...row, id: row.sceneId })));
  const contentHash = hashValue(canonicalScenes);
  const timestamp = nextRevisionTimestamp(document.updatedAt);

  database.prepare(
    "INSERT INTO document_revisions (id, project_id, document_id, revision_number, base_version, content_hash, created_by, request_id, created_at) VALUES (:id, :projectId, :documentId, :revisionNumber, :baseVersion, :contentHash, :createdBy, :requestId, :createdAt)",
  ).run({ id: revisionId, projectId: document.projectId, documentId: document.id, revisionNumber, baseVersion: values.baseVersion, contentHash, createdBy: values.actorId, requestId: values.requestId, createdAt: timestamp });

  for (const row of rows) {
    const previous = getSceneRow(row.sceneId, database);
    const sceneContentHash = hashValue({ title: row.title, content: row.content, status: row.status, continuityGroupId: row.continuityGroupId });
    if (!previous) {
      database.prepare(
        "INSERT INTO scenes (id, project_id, document_id, continuity_group_id, narrative_rank, status, version, created_at, updated_at, deleted_at) VALUES (:id, :projectId, :documentId, :continuityGroupId, :narrativeRank, :status, 1, :createdAt, :updatedAt, :deletedAt)",
      ).run({ id: row.sceneId, projectId: document.projectId, documentId: document.id, continuityGroupId: row.continuityGroupId, narrativeRank: row.narrativeRank, status: row.status, createdAt: timestamp, updatedAt: timestamp, deletedAt: row.status === "deleted" ? timestamp : null });
    } else {
      if (previous.project_id !== document.projectId || previous.document_id !== document.id) {
        throw new StoryBibleValidationError("Scene does not belong to this document", ["scenes"]);
      }
      database.prepare(
        "UPDATE scenes SET continuity_group_id = :continuityGroupId, narrative_rank = :narrativeRank, status = :status, version = version + 1, updated_at = :updatedAt, deleted_at = :deletedAt WHERE id = :id AND project_id = :projectId AND document_id = :documentId",
      ).run({ id: row.sceneId, projectId: document.projectId, documentId: document.id, continuityGroupId: row.continuityGroupId, narrativeRank: row.narrativeRank, status: row.status, updatedAt: timestamp, deletedAt: row.status === "deleted" ? timestamp : null });
    }
    database.prepare(
      "INSERT INTO scene_revisions (id, project_id, document_id, scene_id, continuity_group_id, document_revision_id, narrative_rank, title, content, content_hash, status, created_at) VALUES (:id, :projectId, :documentId, :sceneId, :continuityGroupId, :documentRevisionId, :narrativeRank, :title, :content, :contentHash, :status, :createdAt)",
    ).run({ id: randomUUID(), projectId: document.projectId, documentId: document.id, sceneId: row.sceneId, continuityGroupId: row.continuityGroupId, documentRevisionId: revisionId, narrativeRank: row.narrativeRank, title: row.title, content: row.content, contentHash: sceneContentHash, status: row.status, createdAt: timestamp });
  }

  const updateResult = database.prepare(
    "UPDATE script_documents SET version = :version, current_revision_id = :revisionId, updated_at = :updatedAt WHERE id = :documentId AND project_id = :projectId AND version = :baseVersion",
  ).run({ documentId: document.id, projectId: document.projectId, version: revisionNumber, revisionId, updatedAt: timestamp, baseVersion: values.baseVersion });
  if (updateResult.changes === 0) {
    const latest = getDocumentWithDatabase(document.id, database);
    if (latest) throw new StoryBibleConflictError("document", latest);
    throw new StoryBibleNotFoundError("Document not found");
  }

  const revision = getDocumentRevisionWithDatabase(revisionId, database);
  if (!revision || revision.contentHash !== contentHash) throw new StoryBibleDataIntegrityError("Document revision could not be verified before commit");
  writeEvent(database, { projectId: document.projectId, eventType: "document.revision.created", aggregateType: "document_revision", aggregateId: revision.id, aggregateVersion: revision.revisionNumber, payload: { documentId: document.id, sceneCount: revision.sceneRevisions.length, contentHash }, actorId: values.actorId, requestId: values.requestId });
  return revision;
}

export function listDocuments(projectId: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  getProject(db, projectId);
  const rows = db.prepare(
    "SELECT id, project_id, title, kind, status, version, current_revision_id, created_at, updated_at FROM script_documents WHERE project_id = :projectId ORDER BY updated_at DESC, id ASC",
  ).all({ projectId }) as unknown as ScriptDocumentRow[];
  return rows.map(toScriptDocument);
}

export const listScriptDocuments = listDocuments;

export function getDocument(documentId: string, database?: DatabaseSync) {
  return getDocumentWithDatabase(documentId, resolveDatabase(database));
}

export function getDocumentForProject(projectId: string, documentId: string, database?: DatabaseSync) {
  return getDocumentInProject(documentId, projectId, resolveDatabase(database));
}

function runRevalidationBestEffort(document: ScriptDocument, database: DatabaseSync, actorId: string, revision?: DocumentRevision) {
  const currentRevision = revision ?? (document.currentRevisionId ? getDocumentRevisionWithDatabase(document.currentRevisionId, database) : null);
  if (!currentRevision) return;
  try {
    withTransaction(database, () => {
      for (const sceneRevision of currentRevision.sceneRevisions) {
        revalidateSceneFactPatches(document.projectId, sceneRevision.sceneId, sceneRevision.id, database, actorId);
      }
    });
  } catch (error) {
    /* Revalidation is a best-effort projection. A failed projection must not
     * roll back or report failure for the already committed document save. */
    console.error("story bible revalidation failed", error instanceof Error ? error.message : "unknown error");
  }
}

export function listScenes(documentId: string, projectId?: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  const document = projectId === undefined ? getDocumentWithDatabase(documentId, db) : getDocumentInProject(documentId, projectId, db);
  if (!document) throw new StoryBibleNotFoundError("Document not found");
  return listSceneRows(document.id, db).map(toScene);
}

export function getScene(sceneId: string, projectId?: string, documentId?: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  const row = getSceneRow(sceneId, db);
  if (!row || (projectId !== undefined && row.project_id !== projectId) || (documentId !== undefined && row.document_id !== documentId)) return null;
  return toScene(row);
}

export function createDocument(projectId: string, input: CreateScriptDocumentInput, database?: DatabaseSync) {
  const values = createScriptDocumentInputSchema.parse(input);
  const db = resolveDatabase(database);
  getProject(db, projectId);
  const requestId = values.requestId?.trim() || randomUUID();
  const actorId = values.actorId?.trim() || "local-user";
  const duplicate = getIdempotentResponse(db, projectId, "document.create", requestId);
  if (duplicate?.documentId) return getDocumentInProject(duplicate.documentId, projectId, db) as ScriptDocument;

  const finalDocument = withTransaction(db, () => {
    const id = randomUUID();
    const timestamp = now();
    db.prepare(
      "INSERT INTO script_documents (id, project_id, title, kind, status, version, current_revision_id, created_at, updated_at) VALUES (:id, :projectId, :title, :kind, 'active', 0, NULL, :createdAt, :updatedAt)",
    ).run({ id, projectId, title: values.title, kind: (values.kind ?? values.documentType ?? "screenplay") as string, createdAt: timestamp, updatedAt: timestamp });
    db.prepare("INSERT INTO continuity_groups (id, project_id, document_id, name, kind, is_default, version, created_at, updated_at) VALUES (:id, :projectId, :documentId, 'Main', 'main', 1, 1, :createdAt, :updatedAt)").run({ id, projectId, documentId: id, createdAt: timestamp, updatedAt: timestamp });
    const document = getDocumentInProject(id, projectId, db);
    const revision = insertDocumentRevision(db, document, { baseVersion: 0, requestId, actorId, scenes: values.scenes });
    const finalDocument = getDocumentInProject(id, projectId, db);
    storeIdempotentResponse(db, { projectId, operation: "document.create", requestId, resourceType: "script_document", resourceId: id, response: { documentId: id, revisionId: revision.id } });
    writeEvent(db, { projectId, eventType: "document.created", aggregateType: "script_document", aggregateId: id, aggregateVersion: finalDocument.version, payload: { revisionId: revision.id }, actorId, requestId });
    return finalDocument;
  });
  runRevalidationBestEffort(finalDocument, db, actorId);
  return finalDocument;
}

export const createScriptDocument = createDocument;

export function updateDocument(documentId: string, input: UpdateScriptDocumentInput, database?: DatabaseSync) {
  const values = updateScriptDocumentInputSchema.parse(input);
  const db = resolveDatabase(database);
  const current = getDocumentWithDatabase(documentId, db);
  if (!current) return null;
  const baseVersion = values.baseVersion ?? values.expectedVersion ?? current.version;
  const requestId = values.requestId?.trim() || randomUUID();
  const actorId = values.actorId?.trim() || "local-user";
  const duplicate = getIdempotentResponse(db, current.projectId, "document.update", requestId);
  if (duplicate?.documentId) return getDocumentInProject(duplicate.documentId, current.projectId, db);
  if (current.version !== baseVersion) throw new StoryBibleConflictError("document", current);

  return withTransaction(db, () => {
    const updatedAt = nextRevisionTimestamp(current.updatedAt);
    const result = db.prepare(
      "UPDATE script_documents SET title = COALESCE(:title, title), status = COALESCE(:status, status), version = version + 1, updated_at = :updatedAt WHERE id = :documentId AND project_id = :projectId AND version = :baseVersion",
    ).run({ documentId, projectId: current.projectId, title: values.title ?? null, status: values.status ?? null, updatedAt, baseVersion });
    if (result.changes === 0) {
      const latest = getDocumentWithDatabase(documentId, db);
      if (latest) throw new StoryBibleConflictError("document", latest);
      return null;
    }
    const document = getDocumentWithDatabase(documentId, db) as ScriptDocument;
    storeIdempotentResponse(db, { projectId: current.projectId, operation: "document.update", requestId, resourceType: "script_document", resourceId: documentId, response: { documentId } });
    writeEvent(db, { projectId: current.projectId, eventType: "document.updated", aggregateType: "script_document", aggregateId: documentId, aggregateVersion: document.version, payload: { title: document.title, status: document.status }, actorId, requestId });
    return document;
  });
}

export function createDocumentRevision(documentId: string, input: CreateDocumentRevisionInput, database?: DatabaseSync) {
  const values = createDocumentRevisionInputSchema.parse(input);
  const db = resolveDatabase(database);
  const current = getDocumentWithDatabase(documentId, db);
  if (!current) throw new StoryBibleNotFoundError("Document not found");
  const baseVersion = values.baseVersion ?? values.expectedVersion ?? current.version;
  const requestId = values.requestId?.trim() || randomUUID();
  const actorId = values.actorId?.trim() || "local-user";
  const duplicate = getIdempotentResponse(db, current.projectId, "document.revision", requestId);
  if (duplicate?.revisionId) return getDocumentRevisionWithDatabase(duplicate.revisionId, db) as DocumentRevision;
  if (current.version !== baseVersion) throw new StoryBibleConflictError("document", current);

  const revision = withTransaction(db, () => {
    const latest = getDocumentWithDatabase(documentId, db);
    if (!latest) throw new StoryBibleNotFoundError("Document not found");
    if (latest.version !== baseVersion) throw new StoryBibleConflictError("document", latest);
    const revision = insertDocumentRevision(db, latest, { baseVersion, requestId, actorId, scenes: values.scenes });
    storeIdempotentResponse(db, { projectId: latest.projectId, operation: "document.revision", requestId, resourceType: "document_revision", resourceId: revision.id, response: { documentId, revisionId: revision.id } });
    return revision;
  });
  runRevalidationBestEffort(getDocumentInProject(revision.documentId, revision.projectId, db), db, actorId, revision);
  return revision;
}

export const saveDocumentRevision = createDocumentRevision;

export function listDocumentRevisions(documentId: string, projectId?: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  const document = projectId === undefined ? getDocumentWithDatabase(documentId, db) : getDocumentInProject(documentId, projectId, db);
  if (!document) throw new StoryBibleNotFoundError("Document not found");
  const rows = db.prepare(
    "SELECT id, project_id, document_id, revision_number, base_version, content_hash, created_by, request_id, created_at FROM document_revisions WHERE document_id = :documentId ORDER BY revision_number DESC, id DESC",
  ).all({ documentId }) as unknown as DocumentRevisionRow[];
  return rows.map((row) => getDocumentRevisionWithDatabase(row.id, db) as DocumentRevision);
}

export function getDocumentRevision(revisionId: string, projectId?: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  const revision = getDocumentRevisionWithDatabase(revisionId, db);
  if (!revision || (projectId !== undefined && revision.projectId !== projectId)) return null;
  return revision;
}

export function getSceneRevision(sceneRevisionId: string, projectId?: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  const row = db.prepare(
    "SELECT id, project_id, document_id, scene_id, continuity_group_id, document_revision_id, narrative_rank, title, content, content_hash, status, created_at FROM scene_revisions WHERE id = :sceneRevisionId",
  ).get({ sceneRevisionId }) as unknown as SceneRevisionRow | undefined;
  if (!row || (projectId !== undefined && row.project_id !== projectId)) return null;
  return toSceneRevision(row);
}

/** Resolve the scene revision in the document's current immutable snapshot. */
export function getCurrentSceneRevision(sceneId: string, projectId: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  const row = db.prepare(
    "SELECT sr.id, sr.project_id, sr.document_id, sr.scene_id, sr.continuity_group_id, sr.document_revision_id, sr.narrative_rank, sr.title, sr.content, sr.content_hash, sr.status, sr.created_at FROM scenes s JOIN script_documents d ON d.id = s.document_id AND d.project_id = s.project_id JOIN scene_revisions sr ON sr.document_revision_id = d.current_revision_id AND sr.scene_id = s.id WHERE s.id = :sceneId AND s.project_id = :projectId",
  ).get({ sceneId, projectId }) as unknown as SceneRevisionRow | undefined;
  return row ? toSceneRevision(row) : null;
}

export function getDocumentSnapshot(documentId: string, projectId?: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  const document = projectId === undefined ? getDocumentWithDatabase(documentId, db) : getDocumentInProject(documentId, projectId, db);
  if (!document) return null;
  const revision = document.currentRevisionId ? getDocumentRevisionWithDatabase(document.currentRevisionId, db) : null;
  return { document, revision, scenes: listSceneRows(document.id, db).map(toScene) };
}

export function listAuditEvents(projectId: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  getProject(db, projectId);
  return db.prepare(
    "SELECT id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, actor_id, request_id, created_at FROM audit_events WHERE project_id = :projectId ORDER BY created_at DESC, id DESC",
  ).all({ projectId });
}

export function listOutboxEvents(projectId: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  getProject(db, projectId);
  return db.prepare(
    "SELECT id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, request_id, status, attempts, available_at, published_at, created_at FROM outbox_events WHERE project_id = :projectId ORDER BY created_at DESC, id DESC",
  ).all({ projectId });
}

export function createDocumentRepository(database: DatabaseSync = getDatabase()) {
  return {
    listDocuments: (projectId: string) => listDocuments(projectId, database),
    listScriptDocuments: (projectId: string) => listDocuments(projectId, database),
    getDocument: (documentId: string) => getDocument(documentId, database),
    getDocumentForProject: (projectId: string, documentId: string) => getDocumentForProject(projectId, documentId, database),
    listContinuityGroups: (projectId: string, documentId: string) => listContinuityGroups(documentId, projectId, database),
    createContinuityGroup: (projectId: string, documentId: string, input: CreateContinuityGroupInput) => createContinuityGroup(projectId, documentId, input, database),
    createDocument: (projectId: string, input: CreateScriptDocumentInput) => createDocument(projectId, input, database),
    createScriptDocument: (projectId: string, input: CreateScriptDocumentInput) => createDocument(projectId, input, database),
    updateDocument: (documentId: string, input: UpdateScriptDocumentInput) => updateDocument(documentId, input, database),
    createDocumentRevision: (documentId: string, input: CreateDocumentRevisionInput) => createDocumentRevision(documentId, input, database),
    saveDocumentRevision: (documentId: string, input: CreateDocumentRevisionInput) => createDocumentRevision(documentId, input, database),
    listDocumentRevisions: (documentId: string, projectId?: string) => listDocumentRevisions(documentId, projectId, database),
    getDocumentRevision: (revisionId: string, projectId?: string) => getDocumentRevision(revisionId, projectId, database),
    listScenes: (documentId: string, projectId?: string) => listScenes(documentId, projectId, database),
    getScene: (sceneId: string, projectId?: string, documentId?: string) => getScene(sceneId, projectId, documentId, database),
    getSceneRevision: (sceneRevisionId: string, projectId?: string) => getSceneRevision(sceneRevisionId, projectId, database),
    getCurrentSceneRevision: (sceneId: string, projectId: string) => getCurrentSceneRevision(sceneId, projectId, database),
    getDocumentSnapshot: (documentId: string, projectId?: string) => getDocumentSnapshot(documentId, projectId, database),
    listAuditEvents: (projectId: string) => listAuditEvents(projectId, database),
    listOutboxEvents: (projectId: string) => listOutboxEvents(projectId, database),
  };
}
