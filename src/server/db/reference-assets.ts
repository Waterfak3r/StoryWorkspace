import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  createReferenceAssetInputSchema,
  referenceAssetSchema,
  type CreateReferenceAssetInput,
  type ReferenceAsset,
} from "@/domain/generation-compiler";
import { canonicalContextJson } from "@/domain/context-builder";
import { getDatabase } from "./connection";
import { StoryBibleDataIntegrityError, StoryBibleIdempotencyConflictError, StoryBibleNotFoundError, StoryBibleValidationError } from "./story-bible-errors";

type ReferenceAssetRow = {
  id: string;
  project_id: string;
  entity_id: string;
  kind: "reference_image";
  label: string;
  status: "approved";
  version: number;
  metadata_hash: string;
  created_by: string;
  created_at: string;
};

const OPERATION = "reference_asset.create";

function dbFor(database?: DatabaseSync) {
  return database ?? getDatabase();
}

function now() {
  return new Date().toISOString();
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function parseJson(value: string, message: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new StoryBibleDataIntegrityError(message);
  }
}

function transaction<T>(database: DatabaseSync, operation: () => T) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* preserve the original error */ }
    throw error;
  }
}

function requireProject(database: DatabaseSync, projectId: string) {
  if (!database.prepare("SELECT id FROM projects WHERE id = :projectId").get({ projectId })) {
    throw new StoryBibleNotFoundError("Project not found");
  }
}

function row(database: DatabaseSync, projectId: string, assetId: string) {
  return database.prepare("SELECT id, project_id, entity_id, kind, label, status, version, metadata_hash, created_by, created_at FROM reference_assets WHERE id = :assetId AND project_id = :projectId")
    .get({ assetId, projectId }) as unknown as ReferenceAssetRow | undefined;
}

function toReferenceAsset(value: ReferenceAssetRow): ReferenceAsset {
  return referenceAssetSchema.parse({
    id: value.id,
    projectId: value.project_id,
    entityId: value.entity_id,
    kind: value.kind,
    label: value.label,
    status: value.status,
    version: value.version,
    metadataHash: value.metadata_hash,
    createdBy: value.created_by,
    createdAt: value.created_at,
  });
}

function requestFingerprint(projectId: string, values: ReturnType<typeof createReferenceAssetInputSchema.parse>) {
  return sha256(canonicalContextJson({
    projectId,
    entityId: values.entityId,
    label: values.label,
    actorId: values.actorId,
  }));
}

function metadataHash(values: ReturnType<typeof createReferenceAssetInputSchema.parse>) {
  return sha256(canonicalContextJson({
    entityId: values.entityId,
    kind: "reference_image",
    label: values.label,
  }));
}

function idempotencyRow(database: DatabaseSync, projectId: string, requestId: string) {
  return database.prepare("SELECT resource_id, response_json FROM idempotency_keys WHERE project_id = :projectId AND operation = :operation AND request_id = :requestId")
    .get({ projectId, operation: OPERATION, requestId }) as { resource_id: string; response_json: string } | undefined;
}

function replay(database: DatabaseSync, projectId: string, duplicate: { resource_id: string; response_json: string }, fingerprint: string) {
  const stored = parseJson(duplicate.response_json, "Stored Reference Asset idempotency response is invalid") as { requestFingerprint?: string };
  if (stored.requestFingerprint !== fingerprint) throw new StoryBibleIdempotencyConflictError();
  const asset = row(database, projectId, duplicate.resource_id);
  if (!asset) throw new StoryBibleDataIntegrityError("Idempotent Reference Asset is missing");
  return toReferenceAsset(asset);
}

function storeIdempotency(database: DatabaseSync, values: { projectId: string; requestId: string; resourceId: string; requestFingerprint: string; createdAt: string }) {
  database.prepare("INSERT INTO idempotency_keys (id, project_id, operation, request_id, resource_type, resource_id, response_json, created_at) VALUES (:id, :projectId, :operation, :requestId, 'reference_asset', :resourceId, :responseJson, :createdAt)")
    .run({
      id: randomUUID(),
      projectId: values.projectId,
      operation: OPERATION,
      requestId: values.requestId,
      resourceId: values.resourceId,
      responseJson: JSON.stringify({ referenceAssetId: values.resourceId, requestFingerprint: values.requestFingerprint }),
      createdAt: values.createdAt,
    });
}

function writeEvent(database: DatabaseSync, values: { projectId: string; asset: ReferenceAsset; actorId: string; requestId: string }) {
  const payloadJson = JSON.stringify({ entityId: values.asset.entityId, kind: values.asset.kind, metadataHash: values.asset.metadataHash });
  const eventValues = {
    id: randomUUID(),
    projectId: values.projectId,
    eventType: "reference_asset.created",
    aggregateType: "reference_asset",
    aggregateId: values.asset.id,
    aggregateVersion: values.asset.version,
    payloadJson,
    actorId: values.actorId,
    requestId: values.requestId,
    createdAt: values.asset.createdAt,
  };
  database.prepare("INSERT INTO audit_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, actor_id, request_id, created_at) VALUES (:id, :projectId, :eventType, :aggregateType, :aggregateId, :aggregateVersion, :payloadJson, :actorId, :requestId, :createdAt)")
    .run(eventValues);
  database.prepare("INSERT INTO outbox_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, request_id, status, attempts, available_at, published_at, created_at) VALUES (:id, :projectId, :eventType, :aggregateType, :aggregateId, :aggregateVersion, :payloadJson, :requestId, 'pending', 0, :availableAt, NULL, :createdAt)")
    .run({ id: eventValues.id, projectId: eventValues.projectId, eventType: eventValues.eventType, aggregateType: eventValues.aggregateType, aggregateId: eventValues.aggregateId, aggregateVersion: eventValues.aggregateVersion, payloadJson: eventValues.payloadJson, requestId: eventValues.requestId, availableAt: values.asset.createdAt, createdAt: eventValues.createdAt });
}

export type ReferenceAssetMutationResult = { referenceAsset: ReferenceAsset; idempotent: boolean };

export function createReferenceAsset(projectId: string, input: CreateReferenceAssetInput, database?: DatabaseSync): ReferenceAssetMutationResult {
  const values = createReferenceAssetInputSchema.parse(input);
  const databaseHandle = dbFor(database);
  return transaction(databaseHandle, () => {
    requireProject(databaseHandle, projectId);
    const fingerprint = requestFingerprint(projectId, values);
    const duplicate = idempotencyRow(databaseHandle, projectId, values.requestId);
    if (duplicate) return { referenceAsset: replay(databaseHandle, projectId, duplicate, fingerprint), idempotent: true };

    const entity = databaseHandle.prepare("SELECT id, project_id, status, merged_into_entity_id FROM entities WHERE id = :entityId AND project_id = :projectId")
      .get({ entityId: values.entityId, projectId }) as { id: string; project_id: string; status: string; merged_into_entity_id: string | null } | undefined;
    if (!entity) throw new StoryBibleNotFoundError("Entity not found");
    if (!(["active", "draft"] as string[]).includes(entity.status) || entity.merged_into_entity_id !== null) {
      throw new StoryBibleValidationError("Reference Asset requires an active or draft Entity", ["entityId"]);
    }

    const hash = metadataHash(values);
    const semantic = databaseHandle.prepare("SELECT id, project_id, entity_id, kind, label, status, version, metadata_hash, created_by, created_at FROM reference_assets WHERE project_id = :projectId AND entity_id = :entityId AND kind = 'reference_image' AND metadata_hash = :metadataHash")
      .get({ projectId, entityId: values.entityId, metadataHash: hash }) as unknown as ReferenceAssetRow | undefined;
    if (semantic) {
      const asset = toReferenceAsset(semantic);
      storeIdempotency(databaseHandle, { projectId, requestId: values.requestId, resourceId: asset.id, requestFingerprint: fingerprint, createdAt: asset.createdAt });
      return { referenceAsset: asset, idempotent: true };
    }

    const id = randomUUID();
    const createdAt = now();
    databaseHandle.prepare("INSERT INTO reference_assets (id, project_id, entity_id, kind, label, status, version, metadata_hash, created_by, created_at) VALUES (:id, :projectId, :entityId, 'reference_image', :label, 'approved', 1, :metadataHash, :createdBy, :createdAt)")
      .run({ id, projectId, entityId: values.entityId, label: values.label, metadataHash: hash, createdBy: values.actorId, createdAt });
    const inserted = row(databaseHandle, projectId, id);
    if (!inserted) throw new StoryBibleDataIntegrityError("Created Reference Asset is missing");
    const referenceAsset = toReferenceAsset(inserted);
    storeIdempotency(databaseHandle, { projectId, requestId: values.requestId, resourceId: id, requestFingerprint: fingerprint, createdAt });
    writeEvent(databaseHandle, { projectId, asset: referenceAsset, actorId: values.actorId, requestId: values.requestId });
    return { referenceAsset, idempotent: false };
  });
}

export function getReferenceAsset(assetId: string, projectId: string, database?: DatabaseSync) {
  const databaseHandle = dbFor(database);
  const asset = row(databaseHandle, projectId, assetId);
  return asset ? toReferenceAsset(asset) : null;
}

export function listReferenceAssets(projectId: string, options: { entityId?: string } = {}, database?: DatabaseSync) {
  const databaseHandle = dbFor(database);
  requireProject(databaseHandle, projectId);
  const rows = options.entityId === undefined
    ? databaseHandle.prepare("SELECT id, project_id, entity_id, kind, label, status, version, metadata_hash, created_by, created_at FROM reference_assets WHERE project_id = :projectId AND status = 'approved' ORDER BY entity_id ASC, id ASC").all({ projectId })
    : databaseHandle.prepare("SELECT id, project_id, entity_id, kind, label, status, version, metadata_hash, created_by, created_at FROM reference_assets WHERE project_id = :projectId AND entity_id = :entityId AND status = 'approved' ORDER BY id ASC").all({ projectId, entityId: options.entityId });
  return (rows as unknown as ReferenceAssetRow[]).map(toReferenceAsset);
}

export function createReferenceAssetRepository(database: DatabaseSync = getDatabase()) {
  return {
    create: (projectId: string, input: CreateReferenceAssetInput) => createReferenceAsset(projectId, input, database),
    get: (projectId: string, assetId: string) => getReferenceAsset(assetId, projectId, database),
    list: (projectId: string, options?: Parameters<typeof listReferenceAssets>[1]) => listReferenceAssets(projectId, options, database),
  };
}
