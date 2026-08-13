import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  approveStoryboardInputSchema,
  createStoryboardInputSchema,
  shotSpecContentSchema,
  storyboardSchema,
  type ApproveStoryboardInput,
  type CreateStoryboardInput,
  type ShotSpec,
  type ShotSpecContent,
  type Storyboard,
  type StoryboardStatus,
} from "@/domain/storyboard";
import { canonicalContextJson } from "@/domain/context-builder";
import { getDatabase } from "./connection";
import { getContextSnapshot } from "./context-builder";
import { StoryBibleConflictError, StoryBibleDataIntegrityError, StoryBibleIdempotencyConflictError, StoryBibleNotFoundError, StoryBibleValidationError } from "./story-bible-errors";

type StoryboardRow = {
  id: string; project_id: string; scene_id: string; scene_revision_id: string; context_snapshot_id: string;
  title: string; status: StoryboardStatus; version: number; sealed: number; supersedes_storyboard_id: string | null;
  content_hash: string; created_by: string; created_at: string; updated_at: string;
};
type ShotRow = { id: string; project_id: string; storyboard_id: string; scene_id: string; ordinal: number; spec_json: string; spec_hash: string; created_at: string };
type SqlParams = Record<string, string | number | null>;

const CREATE_OPERATION = "storyboard.create";
const APPROVE_OPERATION = "storyboard.approve";

function dbFor(database?: DatabaseSync) { return database ?? getDatabase(); }
function now() { return new Date().toISOString(); }
function nextUpdatedAt(current: string) {
  const candidate = now();
  const currentMillis = Date.parse(current);
  const candidateMillis = Date.parse(candidate);
  return Number.isFinite(currentMillis) && candidateMillis <= currentMillis ? new Date(currentMillis + 1).toISOString() : candidate;
}
function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }

function transaction<T>(database: DatabaseSync, operation: () => T) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* preserve the original failure */ }
    throw error;
  }
}

function parseJson(value: string, message: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { throw new StoryBibleDataIntegrityError(message); }
}

function boardRow(database: DatabaseSync, projectId: string, storyboardId: string) {
  return database.prepare("SELECT id, project_id, scene_id, scene_revision_id, context_snapshot_id, title, status, version, sealed, supersedes_storyboard_id, content_hash, created_by, created_at, updated_at FROM storyboards WHERE id = :storyboardId AND project_id = :projectId AND sealed = 1").get({ projectId, storyboardId }) as unknown as StoryboardRow | undefined;
}

function shotRows(database: DatabaseSync, projectId: string, storyboardId: string) {
  return database.prepare("SELECT id, project_id, storyboard_id, scene_id, ordinal, spec_json, spec_hash, created_at FROM shot_specs WHERE project_id = :projectId AND storyboard_id = :storyboardId ORDER BY ordinal ASC, id ASC").all({ projectId, storyboardId }) as unknown as ShotRow[];
}

function toShot(row: ShotRow): ShotSpec {
  return {
    id: row.id,
    projectId: row.project_id,
    storyboardId: row.storyboard_id,
    sceneId: row.scene_id,
    spec: shotSpecContentSchema.parse(parseJson(row.spec_json, `Invalid ShotSpec ${row.id}`)),
    specHash: row.spec_hash,
    createdAt: row.created_at,
  };
}

function toStoryboard(database: DatabaseSync, row: StoryboardRow): Storyboard {
  return storyboardSchema.parse({
    id: row.id,
    projectId: row.project_id,
    sceneId: row.scene_id,
    sceneRevisionId: row.scene_revision_id,
    contextSnapshotId: row.context_snapshot_id,
    title: row.title,
    status: row.status,
    version: row.version,
    supersedesStoryboardId: row.supersedes_storyboard_id,
    contentHash: row.content_hash,
    shots: shotRows(database, row.project_id, row.id).map(toShot),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function requireProject(database: DatabaseSync, projectId: string) {
  if (!database.prepare("SELECT 1 FROM projects WHERE id = :projectId").get({ projectId })) throw new StoryBibleNotFoundError("Project not found");
}

function requestFingerprint(projectId: string, sceneId: string, input: unknown) {
  return sha256(canonicalContextJson({ projectId, sceneId, input }));
}

function idempotency(database: DatabaseSync, projectId: string, operation: string, requestId: string) {
  return database.prepare("SELECT resource_id, response_json FROM idempotency_keys WHERE project_id = :projectId AND operation = :operation AND request_id = :requestId").get({ projectId, operation, requestId }) as { resource_id: string; response_json: string } | undefined;
}

function replay(database: DatabaseSync, projectId: string, duplicate: { resource_id: string; response_json: string }, fingerprint: string) {
  const response = parseJson(duplicate.response_json, "Stored Storyboard idempotency response is invalid") as { requestFingerprint?: string };
  if (response.requestFingerprint !== fingerprint) throw new StoryBibleIdempotencyConflictError();
  const row = boardRow(database, projectId, duplicate.resource_id);
  if (!row) throw new StoryBibleDataIntegrityError("Idempotent Storyboard is missing");
  return toStoryboard(database, row);
}

function storeIdempotency(database: DatabaseSync, values: { projectId: string; operation: string; requestId: string; storyboardId: string; fingerprint: string; createdAt: string }) {
  database.prepare("INSERT INTO idempotency_keys (id, project_id, operation, request_id, resource_type, resource_id, response_json, created_at) VALUES (:id, :projectId, :operation, :requestId, 'storyboard', :storyboardId, :responseJson, :createdAt)").run({ id: randomUUID(), projectId: values.projectId, operation: values.operation, requestId: values.requestId, storyboardId: values.storyboardId, responseJson: JSON.stringify({ requestFingerprint: values.fingerprint }), createdAt: values.createdAt });
}

function writeEvent(database: DatabaseSync, values: { projectId: string; eventType: string; storyboardId: string; version: number; actorId: string; requestId: string; payload?: Record<string, unknown> }) {
  const createdAt = now();
  const payloadJson = JSON.stringify(values.payload ?? {});
  const sharedParameters = {
    id: randomUUID(),
    projectId: values.projectId,
    eventType: values.eventType,
    storyboardId: values.storyboardId,
    version: values.version,
    payloadJson,
    requestId: values.requestId,
    createdAt,
  };
  database.prepare("INSERT INTO audit_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, actor_id, request_id, created_at) VALUES (:id, :projectId, :eventType, 'storyboard', :storyboardId, :version, :payloadJson, :actorId, :requestId, :createdAt)").run({ ...sharedParameters, actorId: values.actorId });
  database.prepare("INSERT INTO outbox_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, request_id, status, attempts, available_at, published_at, created_at) VALUES (:id, :projectId, :eventType, 'storyboard', :storyboardId, :version, :payloadJson, :requestId, 'pending', 0, :createdAt, NULL, :createdAt)").run(sharedParameters);
}

function validateShotEntities(contentEntities: Array<{ entityId: string; type: string }>, shots: ShotSpecContent[]) {
  const types = new Map(contentEntities.map((entity) => [entity.entityId, entity.type]));
  for (const [shotIndex, shot] of shots.entries()) {
    for (const [subjectIndex, subject] of shot.subjects.entries()) {
      if (types.get(subject.entityId) !== "character") throw new StoryBibleValidationError("Shot subject must be an included Character", ["shots", shotIndex, "subjects", subjectIndex, "entityId"]);
    }
    if (shot.locationEntityId !== null && types.get(shot.locationEntityId) !== "location") throw new StoryBibleValidationError("Shot location must be an included Location", ["shots", shotIndex, "locationEntityId"]);
    for (const [propIndex, propId] of shot.propEntityIds.entries()) {
      if (types.get(propId) !== "prop") throw new StoryBibleValidationError("Shot prop must be an included Prop", ["shots", shotIndex, "propEntityIds", propIndex]);
    }
  }
}

export type StoryboardMutationResult = { storyboard: Storyboard; idempotent: boolean };

export function createStoryboard(projectId: string, sceneId: string, input: CreateStoryboardInput, database?: DatabaseSync): StoryboardMutationResult {
  const values = createStoryboardInputSchema.parse(input);
  const databaseHandle = dbFor(database);
  return transaction(databaseHandle, () => {
    requireProject(databaseHandle, projectId);
    const fingerprint = requestFingerprint(projectId, sceneId, values);
    const duplicate = idempotency(databaseHandle, projectId, CREATE_OPERATION, values.requestId);
    if (duplicate) return { storyboard: replay(databaseHandle, projectId, duplicate, fingerprint), idempotent: true };

    const snapshot = getContextSnapshot(values.contextSnapshotId, projectId, databaseHandle);
    if (!snapshot || snapshot.sceneId !== sceneId) throw new StoryBibleNotFoundError("Context Snapshot not found for this Scene");
    if (snapshot.purpose !== "storyboard") throw new StoryBibleValidationError("Storyboard requires a Storyboard-purpose Context Snapshot", ["contextSnapshotId"]);
    const scene = databaseHandle.prepare("SELECT status FROM scenes WHERE id = :sceneId AND project_id = :projectId").get({ sceneId, projectId }) as { status: string } | undefined;
    const revision = databaseHandle.prepare("SELECT status FROM scene_revisions WHERE id = :revisionId AND project_id = :projectId AND scene_id = :sceneId").get({ revisionId: snapshot.sceneRevisionId, projectId, sceneId }) as { status: string } | undefined;
    if (!scene || scene.status !== "active" || !revision || revision.status !== "active") throw new StoryBibleValidationError("Storyboard requires a non-deleted Scene and revision", ["contextSnapshotId"]);
    const shots = [...values.shots].sort((left, right) => left.ordinal - right.ordinal);
    validateShotEntities(snapshot.content.entities, shots);
    const contentHash = sha256(canonicalContextJson({ contextSnapshotId: snapshot.id, title: values.title, shots, supersedesStoryboardId: values.supersedesStoryboardId }));
    const semantic = databaseHandle.prepare("SELECT id, project_id, scene_id, scene_revision_id, context_snapshot_id, title, status, version, sealed, supersedes_storyboard_id, content_hash, created_by, created_at, updated_at FROM storyboards WHERE project_id = :projectId AND context_snapshot_id = :contextSnapshotId AND content_hash = :contentHash AND sealed = 1 AND status IN ('draft', 'approved')").get({ projectId, contextSnapshotId: snapshot.id, contentHash }) as unknown as StoryboardRow | undefined;
    if (semantic) {
      const storyboard = toStoryboard(databaseHandle, semantic);
      storeIdempotency(databaseHandle, { projectId, operation: CREATE_OPERATION, requestId: values.requestId, storyboardId: storyboard.id, fingerprint, createdAt: storyboard.createdAt });
      return { storyboard, idempotent: true };
    }

    let superseded: Storyboard | null = null;
    let oldRow: StoryboardRow | null = null;
    if (values.supersedesStoryboardId) {
      oldRow = boardRow(databaseHandle, projectId, values.supersedesStoryboardId) ?? null;
      if (!oldRow || oldRow.scene_id !== sceneId) throw new StoryBibleNotFoundError("Superseded Storyboard not found");
      superseded = toStoryboard(databaseHandle, oldRow);
      if (oldRow.version !== values.expectedSupersededVersion || oldRow.status === "superseded") throw new StoryBibleConflictError("storyboard", superseded);
    }

    const id = randomUUID();
    const createdAt = now();
    databaseHandle.prepare("INSERT INTO storyboards (id, project_id, scene_id, scene_revision_id, context_snapshot_id, title, status, version, sealed, supersedes_storyboard_id, content_hash, created_by, created_at, updated_at) VALUES (:id, :projectId, :sceneId, :sceneRevisionId, :contextSnapshotId, :title, 'draft', 1, 0, :supersedesStoryboardId, :contentHash, :createdBy, :createdAt, :createdAt)").run({ id, projectId, sceneId, sceneRevisionId: snapshot.sceneRevisionId, contextSnapshotId: snapshot.id, title: values.title, supersedesStoryboardId: values.supersedesStoryboardId, contentHash, createdBy: values.actorId, createdAt });
    const insertShot = databaseHandle.prepare("INSERT INTO shot_specs (id, project_id, storyboard_id, scene_id, ordinal, spec_json, spec_hash, created_at) VALUES (:id, :projectId, :storyboardId, :sceneId, :ordinal, :specJson, :specHash, :createdAt)");
    for (const shot of shots) {
      const specJson = canonicalContextJson(shot);
      insertShot.run({ id: randomUUID(), projectId, storyboardId: id, sceneId, ordinal: shot.ordinal, specJson, specHash: sha256(specJson), createdAt });
    }
    const sealed = databaseHandle.prepare("UPDATE storyboards SET sealed = 1 WHERE id = :id AND project_id = :projectId AND sealed = 0").run({ id, projectId });
    if (sealed.changes !== 1) throw new StoryBibleDataIntegrityError("Created Storyboard could not be sealed");
    if (oldRow && superseded) {
      const updatedAt = nextUpdatedAt(oldRow.updated_at);
      const changed = databaseHandle.prepare("UPDATE storyboards SET status = 'superseded', version = version + 1, updated_at = :updatedAt WHERE id = :id AND project_id = :projectId AND version = :version AND status IN ('draft', 'approved')").run({ updatedAt, id: oldRow.id, projectId, version: oldRow.version });
      if (changed.changes !== 1) throw new StoryBibleConflictError("storyboard", superseded);
      writeEvent(databaseHandle, { projectId, eventType: "storyboard.superseded", storyboardId: oldRow.id, version: oldRow.version + 1, actorId: values.actorId, requestId: values.requestId, payload: { replacementStoryboardId: id } });
    }
    const row = boardRow(databaseHandle, projectId, id);
    if (!row) throw new StoryBibleDataIntegrityError("Created Storyboard is missing");
    const storyboard = toStoryboard(databaseHandle, row);
    storeIdempotency(databaseHandle, { projectId, operation: CREATE_OPERATION, requestId: values.requestId, storyboardId: id, fingerprint, createdAt });
    writeEvent(databaseHandle, { projectId, eventType: "storyboard.created", storyboardId: id, version: 1, actorId: values.actorId, requestId: values.requestId, payload: { sceneId, sceneRevisionId: snapshot.sceneRevisionId, contextSnapshotId: snapshot.id, contentHash, supersedesStoryboardId: superseded?.id ?? null } });
    return { storyboard, idempotent: false };
  });
}

export function approveStoryboard(projectId: string, storyboardId: string, input: ApproveStoryboardInput, database?: DatabaseSync): StoryboardMutationResult {
  const values = approveStoryboardInputSchema.parse(input);
  const databaseHandle = dbFor(database);
  return transaction(databaseHandle, () => {
    requireProject(databaseHandle, projectId);
    const fingerprint = requestFingerprint(projectId, storyboardId, values);
    const duplicate = idempotency(databaseHandle, projectId, APPROVE_OPERATION, values.requestId);
    if (duplicate) return { storyboard: replay(databaseHandle, projectId, duplicate, fingerprint), idempotent: true };
    const row = boardRow(databaseHandle, projectId, storyboardId);
    if (!row) throw new StoryBibleNotFoundError("Storyboard not found");
    const current = toStoryboard(databaseHandle, row);
    if (row.version !== values.expectedVersion) throw new StoryBibleConflictError("storyboard", current);
    if (row.status !== "draft") throw new StoryBibleValidationError("Only a draft Storyboard can be approved", ["status"]);
    const updatedAt = nextUpdatedAt(row.updated_at);
    const changed = databaseHandle.prepare("UPDATE storyboards SET status = 'approved', version = version + 1, updated_at = :updatedAt WHERE id = :storyboardId AND project_id = :projectId AND version = :version AND status = 'draft'").run({ updatedAt, storyboardId, projectId, version: values.expectedVersion });
    if (changed.changes !== 1) throw new StoryBibleConflictError("storyboard", current);
    const updated = boardRow(databaseHandle, projectId, storyboardId);
    if (!updated) throw new StoryBibleDataIntegrityError("Approved Storyboard is missing");
    const storyboard = toStoryboard(databaseHandle, updated);
    storeIdempotency(databaseHandle, { projectId, operation: APPROVE_OPERATION, requestId: values.requestId, storyboardId, fingerprint, createdAt: updatedAt });
    writeEvent(databaseHandle, { projectId, eventType: "storyboard.approved", storyboardId, version: storyboard.version, actorId: values.actorId, requestId: values.requestId, payload: { contextSnapshotId: storyboard.contextSnapshotId, contentHash: storyboard.contentHash } });
    return { storyboard, idempotent: false };
  });
}

export function getStoryboard(storyboardId: string, projectId: string, database?: DatabaseSync) {
  const databaseHandle = dbFor(database);
  const row = boardRow(databaseHandle, projectId, storyboardId);
  return row ? toStoryboard(databaseHandle, row) : null;
}

export function listStoryboards(projectId: string, sceneId: string, options: { contextSnapshotId?: string; status?: StoryboardStatus } = {}, database?: DatabaseSync) {
  const databaseHandle = dbFor(database);
  requireProject(databaseHandle, projectId);
  const conditions = ["project_id = :projectId", "scene_id = :sceneId"];
  const params: SqlParams = { projectId, sceneId };
  if (options.contextSnapshotId) { conditions.push("context_snapshot_id = :contextSnapshotId"); params.contextSnapshotId = options.contextSnapshotId; }
  if (options.status) { conditions.push("status = :status"); params.status = options.status; }
  conditions.push("sealed = 1");
  const rows = databaseHandle.prepare(`SELECT id, project_id, scene_id, scene_revision_id, context_snapshot_id, title, status, version, sealed, supersedes_storyboard_id, content_hash, created_by, created_at, updated_at FROM storyboards WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, id DESC`).all(params) as unknown as StoryboardRow[];
  return rows.map((row) => toStoryboard(databaseHandle, row));
}

export function createStoryboardRepository(database: DatabaseSync = getDatabase()) {
  return {
    create: (projectId: string, sceneId: string, input: CreateStoryboardInput) => createStoryboard(projectId, sceneId, input, database),
    approve: (projectId: string, storyboardId: string, input: ApproveStoryboardInput) => approveStoryboard(projectId, storyboardId, input, database),
    get: (storyboardId: string, projectId: string) => getStoryboard(storyboardId, projectId, database),
    list: (projectId: string, sceneId: string, options?: Parameters<typeof listStoryboards>[2]) => listStoryboards(projectId, sceneId, options, database),
  };
}
