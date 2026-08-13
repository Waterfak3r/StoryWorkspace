import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  canonicalContextJson,
  contextContentSchema,
  type ContextContent,
} from "@/domain/context-builder";
import {
  compiledGenerationRequestSchema,
  compileShotInputSchema,
  FAKE_VIDEO_CAPABILITY_PROFILE,
  FAKE_VIDEO_COMPILER_VERSION,
  type CompiledGenerationRequest,
  type CompileShotInput,
  type CompileShotResult,
  fakePreparedRequestSchema,
} from "@/domain/generation-compiler";
import { shotSpecContentSchema, type ShotSpecContent } from "@/domain/storyboard";
import { getDatabase } from "./connection";
import { StoryBibleDataIntegrityError, StoryBibleIdempotencyConflictError, StoryBibleNotFoundError, StoryBibleValidationError } from "./story-bible-errors";
import { fakeVideoAdapter } from "../media/fake-video-adapter";

type ShotRow = {
  id: string;
  project_id: string;
  storyboard_id: string;
  scene_id: string;
  ordinal: number;
  spec_json: string;
  spec_hash: string;
  created_at: string;
};
type BoardRow = {
  id: string;
  project_id: string;
  scene_id: string;
  context_snapshot_id: string;
  status: "approved";
  sealed: number;
};
type ContextRow = {
  id: string;
  project_id: string;
  scene_id: string;
  content_json: string;
  content_hash: string;
  purpose: "storyboard" | "video";
};
type AssetRow = {
  id: string;
  project_id: string;
  entity_id: string;
  kind: "reference_image";
  label: string;
  status: "approved";
  version: 1;
  metadata_hash: string;
  created_by: string;
  created_at: string;
};
type CompiledRow = {
  id: string;
  project_id: string;
  scene_id: string;
  shot_spec_id: string;
  context_snapshot_id: string;
  compiled_json: string;
  prepared_json: string;
};

const OPERATION = "shot.compile";
const ROLE_ORDER: Record<"primary" | "secondary" | "background", number> = { primary: 0, secondary: 1, background: 2 };
const PURPOSE_ORDER: Record<"character" | "location" | "prop", number> = { character: 0, location: 1, prop: 2 };

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

function requestFingerprint(projectId: string, shotSpecId: string, values: ReturnType<typeof compileShotInputSchema.parse>) {
  return sha256(canonicalContextJson({ projectId, shotSpecId, input: values }));
}

function toShot(row: ShotRow) {
  const parsed = shotSpecContentSchema.safeParse(parseJson(row.spec_json, `Invalid ShotSpec ${row.id}`));
  if (!parsed.success) throw new StoryBibleDataIntegrityError(`Invalid ShotSpec ${row.id}`);
  return parsed.data;
}

function toContext(row: ContextRow): ContextContent {
  const parsed = contextContentSchema.safeParse(parseJson(row.content_json, `Invalid Context Snapshot ${row.id}`));
  if (!parsed.success) throw new StoryBibleDataIntegrityError(`Invalid Context Snapshot ${row.id}`);
  return parsed.data;
}

function assetRow(database: DatabaseSync, projectId: string, assetId: string) {
  return database.prepare("SELECT id, project_id, entity_id, kind, label, status, version, metadata_hash, created_by, created_at FROM reference_assets WHERE id = :assetId AND project_id = :projectId")
    .get({ assetId, projectId }) as unknown as AssetRow | undefined;
}

function compiledRow(database: DatabaseSync, projectId: string, compiledRequestId: string) {
  return database.prepare("SELECT id, project_id, scene_id, shot_spec_id, context_snapshot_id, compiled_json, prepared_json FROM compiled_generation_requests WHERE id = :compiledRequestId AND project_id = :projectId")
    .get({ compiledRequestId, projectId }) as unknown as CompiledRow | undefined;
}

function idempotencyRow(database: DatabaseSync, projectId: string, requestId: string) {
  return database.prepare("SELECT resource_id, response_json FROM idempotency_keys WHERE project_id = :projectId AND operation = :operation AND request_id = :requestId")
    .get({ projectId, operation: OPERATION, requestId }) as { resource_id: string; response_json: string } | undefined;
}

function replay(database: DatabaseSync, projectId: string, duplicate: { resource_id: string; response_json: string }, fingerprint: string): CompileShotResult {
  const stored = parseJson(duplicate.response_json, "Stored Compile idempotency response is invalid") as { requestFingerprint?: string };
  if (stored.requestFingerprint !== fingerprint) throw new StoryBibleIdempotencyConflictError();
  const existing = getCompiledGenerationRequest(duplicate.resource_id, projectId, database);
  if (!existing) throw new StoryBibleDataIntegrityError("Idempotent compiled request is missing");
  return { ...existing, idempotent: true };
}

function storeIdempotency(database: DatabaseSync, values: { projectId: string; requestId: string; resourceId: string; requestFingerprint: string; createdAt: string }) {
  database.prepare("INSERT INTO idempotency_keys (id, project_id, operation, request_id, resource_type, resource_id, response_json, created_at) VALUES (:id, :projectId, :operation, :requestId, 'compiled_generation_request', :resourceId, :responseJson, :createdAt)")
    .run({
      id: randomUUID(),
      projectId: values.projectId,
      operation: OPERATION,
      requestId: values.requestId,
      resourceId: values.resourceId,
      responseJson: JSON.stringify({ compiledRequestId: values.resourceId, requestFingerprint: values.requestFingerprint }),
      createdAt: values.createdAt,
    });
}

function writeEvent(database: DatabaseSync, values: { projectId: string; request: CompiledGenerationRequest; actorId: string; requestId: string }) {
  const payloadJson = JSON.stringify({
    sceneId: values.request.sceneId,
    shotSpecId: values.request.shotSpecId,
    contextSnapshotId: values.request.contextSnapshotId,
    inputHash: values.request.inputHash,
    compiledHash: values.request.compiledHash,
  });
  const eventValues = {
    id: randomUUID(),
    projectId: values.projectId,
    eventType: "shot.compiled",
    aggregateType: "compiled_generation_request",
    aggregateId: values.request.id,
    aggregateVersion: 1,
    payloadJson,
    actorId: values.actorId,
    requestId: values.requestId,
    createdAt: values.request.createdAt,
  };
  database.prepare("INSERT INTO audit_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, actor_id, request_id, created_at) VALUES (:id, :projectId, :eventType, :aggregateType, :aggregateId, :aggregateVersion, :payloadJson, :actorId, :requestId, :createdAt)")
    .run(eventValues);
  database.prepare("INSERT INTO outbox_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, request_id, status, attempts, available_at, published_at, created_at) VALUES (:id, :projectId, :eventType, :aggregateType, :aggregateId, :aggregateVersion, :payloadJson, :requestId, 'pending', 0, :availableAt, NULL, :createdAt)")
    .run({ id: eventValues.id, projectId: eventValues.projectId, eventType: eventValues.eventType, aggregateType: eventValues.aggregateType, aggregateId: eventValues.aggregateId, aggregateVersion: eventValues.aggregateVersion, payloadJson: eventValues.payloadJson, requestId: eventValues.requestId, availableAt: values.request.createdAt, createdAt: eventValues.createdAt });
}

function rankAssets(shot: ShotSpecContent, rows: AssetRow[]) {
  const subjects = new Map(shot.subjects.map((subject) => [subject.entityId, subject]));
  const location = shot.locationEntityId;
  const props = new Set(shot.propEntityIds);
  const ranked = rows.map((asset) => {
    const subject = subjects.get(asset.entity_id);
    if (subject) return { asset, purpose: "character" as const, rank: ROLE_ORDER[subject.framingRole], entityRank: asset.entity_id };
    if (asset.entity_id === location) return { asset, purpose: "location" as const, rank: 3, entityRank: asset.entity_id };
    if (props.has(asset.entity_id)) return { asset, purpose: "prop" as const, rank: 4, entityRank: asset.entity_id };
    throw new StoryBibleValidationError("Reference Asset is unrelated to this Shot", ["referenceAssetIds"]);
  });
  return ranked.sort((left, right) => left.rank - right.rank || PURPOSE_ORDER[left.purpose] - PURPOSE_ORDER[right.purpose] || left.entityRank.localeCompare(right.entityRank) || left.asset.id.localeCompare(right.asset.id));
}

function contextEntityMap(content: ContextContent) {
  return new Map(content.entities.map((entity) => [entity.entityId, entity]));
}

function stateText(entity: ContextContent["entities"][number]) {
  const fields = entity.resolvedState?.fields.filter((field) => field.value !== null && field.tier !== "missing" && !field.blockingConflict).sort((left, right) => left.predicate.localeCompare(right.predicate)) ?? [];
  return fields.map((field) => `${field.predicate}=${String(field.value)}`).join("; ");
}

function identityText(entity: ContextContent["entities"][number], includeFacts: boolean) {
  if (!includeFacts) return entity.canonicalName;
  const facts = entity.baseFacts.slice().sort((left, right) => left.predicate.localeCompare(right.predicate) || left.factId.localeCompare(right.factId)).map((fact) => `${fact.predicate}=${String(fact.value)}`);
  return facts.length > 0 ? `${entity.canonicalName} (${facts.join("; ")})` : entity.canonicalName;
}

function segment(role: "scene" | "character" | "state" | "camera" | "style" | "constraint", text: string, sourceIds: string[]) {
  return { role, text: text.trim(), sourceIds: [...new Set(sourceIds)] };
}

function buildSegments(shot: ShotSpecContent, shotSpecId: string, context: ContextContent, selectedEntityIds: Set<string>) {
  const entities = contextEntityMap(context);
  const segments: Array<ReturnType<typeof segment>> = [];
  segments.push(segment("scene", `Shot intent: ${shot.narrativePurpose}.`, [shotSpecId]));

  const subjects = [...shot.subjects].sort((left, right) => ROLE_ORDER[left.framingRole] - ROLE_ORDER[right.framingRole] || left.entityId.localeCompare(right.entityId));
  for (const subject of subjects) {
    const entity = entities.get(subject.entityId);
    if (!entity) throw new StoryBibleValidationError("Shot subject is absent from the frozen Context Snapshot", ["subjects"]);
    const identity = identityText(entity, !selectedEntityIds.has(subject.entityId));
    const expression = subject.expression ? `, expression ${subject.expression}` : "";
    segments.push(segment("character", `${identity}: ${subject.action}${expression}.`, [subject.entityId, shotSpecId]));
    const state = stateText(entity);
    if (state) segments.push(segment("state", `${entity.canonicalName} state: ${state}.`, [entity.entityId, shotSpecId]));
  }

  if (shot.locationEntityId) {
    const location = entities.get(shot.locationEntityId);
    if (!location) throw new StoryBibleValidationError("Shot location is absent from the frozen Context Snapshot", ["locationEntityId"]);
    segments.push(segment("scene", `Location: ${identityText(location, !selectedEntityIds.has(location.entityId))}.`, [location.entityId, shotSpecId]));
    const state = stateText(location);
    if (state) segments.push(segment("state", `${location.canonicalName} state: ${state}.`, [location.entityId, shotSpecId]));
  }
  for (const propId of [...shot.propEntityIds].sort()) {
    const prop = entities.get(propId);
    if (!prop) throw new StoryBibleValidationError("Shot prop is absent from the frozen Context Snapshot", ["propEntityIds"]);
    segments.push(segment("state", `Prop: ${identityText(prop, !selectedEntityIds.has(prop.entityId))}.`, [prop.entityId, shotSpecId]));
  }

  const camera = [shot.framing && `framing ${shot.framing}`, shot.cameraMotion && `camera motion ${shot.cameraMotion}`, shot.lens && `lens ${shot.lens}`].filter(Boolean).join(", ");
  if (camera) segments.push(segment("camera", `Camera: ${camera}.`, [shotSpecId]));
  if (shot.continuityConstraints.length > 0) segments.push(segment("constraint", `Continuity constraints: ${shot.continuityConstraints.join("; ")}.`, [shotSpecId]));
  const sceneText = context.scene.text.trim();
  if (sceneText) segments.push(segment("scene", `Scene evidence (${context.scene.title}): ${sceneText}`, [context.scene.revisionId]));
  return segments;
}

function fitSegments(segments: Array<ReturnType<typeof segment>>, maxChars: number, shotSpecId: string, warnings: string[], omitted: string[]) {
  const kept: Array<ReturnType<typeof segment>> = [];
  let used = 0;
  const sceneBudget = Math.min(800, Math.floor(maxChars * 0.2));
  const sceneEvidence = segments.length > 0 && segments[segments.length - 1].role === "scene" ? segments[segments.length - 1] : null;
  for (const candidate of segments) {
    const candidateMax = candidate === sceneEvidence ? sceneBudget : maxChars;
    const separator = kept.length > 0 ? 1 : 0;
    const remaining = maxChars - used - separator;
    if (remaining <= 0) {
      omitted.push(`prompt:${candidate.role}:${candidate.sourceIds[0]}`);
      warnings.push(`Prompt budget omitted ${candidate.role} context.`);
      continue;
    }
    const allowed = Math.min(remaining, candidateMax);
    if (candidate.text.length <= allowed) {
      kept.push(candidate);
      used += separator + candidate.text.length;
      continue;
    }
    if (allowed >= 24) {
      kept.push(segment(candidate.role, candidate.text.slice(0, allowed), candidate.sourceIds));
      used += separator + allowed;
      warnings.push(`Prompt budget clipped ${candidate.role} context.`);
      omitted.push(`prompt:${candidate.role}:${candidate.sourceIds[0]}`);
    } else {
      omitted.push(`prompt:${candidate.role}:${candidate.sourceIds[0]}`);
      warnings.push(`Prompt budget omitted ${candidate.role} context.`);
    }
  }
  void shotSpecId;
  return kept;
}

function normalizedParameters(shot: ShotSpecContent, input: ReturnType<typeof compileShotInputSchema.parse>, warnings: string[]) {
  const requestedDuration = input.parameters.durationSeconds ?? shot.durationSeconds ?? 6;
  const durations = FAKE_VIDEO_CAPABILITY_PROFILE.limits.durationSeconds;
  const duration = durations.includes(requestedDuration as 4 | 6 | 8)
    ? requestedDuration as 4 | 6 | 8
    : durations.find((candidate) => candidate >= requestedDuration) ?? 8;
  if (duration !== requestedDuration) warnings.push(`Duration ${requestedDuration}s is unsupported; using ${duration}s.`);

  const requestedAspect = input.parameters.aspectRatio ?? "16:9";
  const aspectRatio = (FAKE_VIDEO_CAPABILITY_PROFILE.limits.aspectRatios as readonly string[]).includes(requestedAspect) ? requestedAspect as "16:9" | "9:16" : "16:9";
  if (aspectRatio !== requestedAspect) warnings.push(`Aspect ratio ${requestedAspect} is unsupported; using 16:9.`);
  return { durationSeconds: duration, aspectRatio };
}

function normalizedNegativePrompt(shot: ShotSpecContent, warnings: string[], omittedContext: string[]) {
  if (shot.negativeConstraints.length === 0) return null;
  const joined = shot.negativeConstraints.join("; ");
  if (joined.length <= FAKE_VIDEO_CAPABILITY_PROFILE.limits.promptChars) return joined;
  warnings.push(`Negative prompt exceeded ${FAKE_VIDEO_CAPABILITY_PROFILE.limits.promptChars} characters and was clipped.`);
  omittedContext.push("negative_constraints:budget");
  return joined.slice(0, FAKE_VIDEO_CAPABILITY_PROFILE.limits.promptChars);
}

function compiledCore(request: Omit<CompiledGenerationRequest, "id" | "createdAt" | "inputHash" | "compiledHash">) {
  return request;
}

function toResult(row: CompiledRow): { compiledRequest: CompiledGenerationRequest; preview: ReturnType<typeof fakeVideoAdapter.prepare> } {
  const compiled = compiledGenerationRequestSchema.safeParse(parseJson(row.compiled_json, `Invalid compiled request ${row.id}`));
  if (!compiled.success) throw new StoryBibleDataIntegrityError(`Invalid compiled request ${row.id}`);
  const preview = fakePreparedRequestSchema.safeParse(parseJson(row.prepared_json, `Invalid prepared request ${row.id}`));
  if (!preview.success) throw new StoryBibleDataIntegrityError(`Invalid prepared request ${row.id}`);
  return { compiledRequest: compiled.data, preview: preview.data };
}

export function getCompiledGenerationRequest(compiledRequestId: string, projectId: string, database?: DatabaseSync) {
  const databaseHandle = dbFor(database);
  const row = compiledRow(databaseHandle, projectId, compiledRequestId);
  return row ? toResult(row) : null;
}

export type CompileMutationResult = CompileShotResult;

export function compileShot(projectId: string, shotSpecId: string, input: CompileShotInput, database?: DatabaseSync): CompileMutationResult {
  const values = compileShotInputSchema.parse(input);
  const databaseHandle = dbFor(database);
  return transaction(databaseHandle, () => {
    requireProject(databaseHandle, projectId);
    const fingerprint = requestFingerprint(projectId, shotSpecId, values);
    const duplicate = idempotencyRow(databaseHandle, projectId, values.requestId);
    if (duplicate) return replay(databaseHandle, projectId, duplicate, fingerprint);

    const shotRow = databaseHandle.prepare("SELECT id, project_id, storyboard_id, scene_id, ordinal, spec_json, spec_hash, created_at FROM shot_specs WHERE id = :shotSpecId AND project_id = :projectId")
      .get({ shotSpecId, projectId }) as unknown as ShotRow | undefined;
    if (!shotRow) throw new StoryBibleNotFoundError("ShotSpec not found");
    const board = databaseHandle.prepare("SELECT id, project_id, scene_id, context_snapshot_id, status, sealed FROM storyboards WHERE id = :storyboardId AND project_id = :projectId")
      .get({ storyboardId: shotRow.storyboard_id, projectId }) as unknown as BoardRow | undefined;
    if (!board) throw new StoryBibleNotFoundError("Storyboard not found");
    if (board.status !== "approved" || board.sealed !== 1) throw new StoryBibleValidationError("Compile requires an approved sealed Storyboard", ["shotSpecId"]);
    const scene = databaseHandle.prepare("SELECT status FROM scenes WHERE id = :sceneId AND project_id = :projectId").get({ sceneId: shotRow.scene_id, projectId }) as { status: string } | undefined;
    if (!scene || scene.status === "deleted") throw new StoryBibleValidationError("Compile requires an active Scene", ["shotSpecId"]);
    const contextRow = databaseHandle.prepare("SELECT id, project_id, scene_id, content_json, content_hash, purpose FROM context_snapshots WHERE id = :contextSnapshotId AND project_id = :projectId")
      .get({ contextSnapshotId: board.context_snapshot_id, projectId }) as unknown as ContextRow | undefined;
    if (!contextRow || contextRow.scene_id !== board.scene_id) throw new StoryBibleNotFoundError("Storyboard Context Snapshot not found");
    const context = toContext(contextRow);
    if (context.hasBlockingIssues) throw new StoryBibleValidationError("Compile is blocked by Context Snapshot issues", ["contextSnapshotId"]);
    const shot = toShot(shotRow);
    const inputAssetIds = values.referenceAssetIds;
    const assets: AssetRow[] = [];
    for (const assetId of inputAssetIds) {
      const asset = assetRow(databaseHandle, projectId, assetId);
      if (!asset) throw new StoryBibleNotFoundError("Reference Asset not found");
      if (asset.status !== "approved" || asset.version !== 1) throw new StoryBibleValidationError("Reference Asset is not approved", ["referenceAssetIds"]);
      assets.push(asset);
    }
    const rankedAssets = rankAssets(shot, assets);
    const warnings: string[] = [];
    const omittedContext: string[] = [];
    const selectedAssets = rankedAssets.slice(0, FAKE_VIDEO_CAPABILITY_PROFILE.supports.maxReferenceImages);
    for (const omittedAsset of rankedAssets.slice(FAKE_VIDEO_CAPABILITY_PROFILE.supports.maxReferenceImages)) {
      warnings.push(`Reference Asset ${omittedAsset.asset.id} was omitted because fake-video supports at most 2 references.`);
      omittedContext.push(`reference_asset:${omittedAsset.asset.id}`);
    }
    if (selectedAssets.length === 0) warnings.push("No approved reference assets selected; compiling text-only input.");
    const selectedEntityIds = new Set(selectedAssets.map((entry) => entry.asset.entity_id));
    const promptSegments = fitSegments(buildSegments(shot, shotSpecId, context, selectedEntityIds), FAKE_VIDEO_CAPABILITY_PROFILE.limits.promptChars, shotSpecId, warnings, omittedContext);
    const negativePrompt = normalizedNegativePrompt(shot, warnings, omittedContext);
    const parameters = normalizedParameters(shot, values, warnings);
    const inputHash = sha256(canonicalContextJson({
      projectId,
      sceneId: board.scene_id,
      shotSpecId,
      storyboardId: board.id,
      storyboardStatus: board.status,
      contextSnapshotId: contextRow.id,
      contextHash: contextRow.content_hash,
      shotHash: shotRow.spec_hash,
      capabilityProfile: FAKE_VIDEO_CAPABILITY_PROFILE,
      compilerVersion: FAKE_VIDEO_COMPILER_VERSION,
      assets: assets.map((asset) => ({ id: asset.id, entityId: asset.entity_id, version: asset.version, metadataHash: asset.metadata_hash })).sort((left, right) => left.id.localeCompare(right.id)),
      requestedParameters: {
        durationSeconds: values.parameters.durationSeconds ?? null,
        aspectRatio: values.parameters.aspectRatio ?? null,
      },
      parameters,
    }));
    const semantic = databaseHandle.prepare("SELECT id, project_id, scene_id, shot_spec_id, context_snapshot_id, compiled_json, prepared_json FROM compiled_generation_requests WHERE project_id = :projectId AND input_hash = :inputHash")
      .get({ projectId, inputHash }) as unknown as CompiledRow | undefined;
    if (semantic) {
      const existing = toResult(semantic);
      storeIdempotency(databaseHandle, { projectId, requestId: values.requestId, resourceId: existing.compiledRequest.id, requestFingerprint: fingerprint, createdAt: existing.compiledRequest.createdAt });
      return { ...existing, idempotent: true };
    }

    const base = compiledCore({
      projectId,
      sceneId: board.scene_id,
      shotSpecId,
      contextSnapshotId: contextRow.id,
      provider: "fake-video",
      model: "fake-video-model-v1",
      capabilityProfileId: FAKE_VIDEO_CAPABILITY_PROFILE.id,
      capabilityProfileVersion: FAKE_VIDEO_CAPABILITY_PROFILE.version,
      compilerVersion: FAKE_VIDEO_COMPILER_VERSION,
      promptSegments,
      negativePrompt,
      assetInputs: selectedAssets.map((entry) => ({ assetId: entry.asset.id, entityId: entry.asset.entity_id, purpose: entry.purpose, weight: entry.purpose === "character" ? 1 : 0.8 })),
      providerBindings: [],
      parameters,
      warnings,
      omittedContext,
    });
    const compiledHash = sha256(canonicalContextJson(base));
    const id = randomUUID();
    const createdAt = now();
    const compiledRequest = compiledGenerationRequestSchema.parse({ ...base, id, inputHash, compiledHash, createdAt });
    const validation = fakeVideoAdapter.validate(compiledRequest);
    if (!validation.valid) throw new StoryBibleValidationError(validation.issues.join("; "), ["parameters"]);
    const preview = fakeVideoAdapter.prepare(compiledRequest);
    databaseHandle.prepare("INSERT INTO compiled_generation_requests (id, project_id, scene_id, shot_spec_id, context_snapshot_id, provider, model, capability_profile_id, capability_profile_version, compiler_version, compiled_json, prepared_json, input_hash, compiled_hash, created_at) VALUES (:id, :projectId, :sceneId, :shotSpecId, :contextSnapshotId, :provider, :model, :capabilityProfileId, :capabilityProfileVersion, :compilerVersion, :compiledJson, :preparedJson, :inputHash, :compiledHash, :createdAt)")
      .run({ id, projectId, sceneId: board.scene_id, shotSpecId, contextSnapshotId: contextRow.id, provider: compiledRequest.provider, model: compiledRequest.model, capabilityProfileId: compiledRequest.capabilityProfileId, capabilityProfileVersion: compiledRequest.capabilityProfileVersion, compilerVersion: compiledRequest.compilerVersion, compiledJson: JSON.stringify(compiledRequest), preparedJson: JSON.stringify(preview), inputHash, compiledHash, createdAt });
    storeIdempotency(databaseHandle, { projectId, requestId: values.requestId, resourceId: id, requestFingerprint: fingerprint, createdAt });
    writeEvent(databaseHandle, { projectId, request: compiledRequest, actorId: values.actorId, requestId: values.requestId });
    return { compiledRequest, preview, idempotent: false };
  });
}

export function listCompiledGenerationRequests(projectId: string, shotSpecId?: string, database?: DatabaseSync) {
  const databaseHandle = dbFor(database);
  requireProject(databaseHandle, projectId);
  const rows = shotSpecId === undefined
    ? databaseHandle.prepare("SELECT id, project_id, scene_id, shot_spec_id, context_snapshot_id, compiled_json, prepared_json FROM compiled_generation_requests WHERE project_id = :projectId ORDER BY created_at DESC, id DESC").all({ projectId })
    : databaseHandle.prepare("SELECT id, project_id, scene_id, shot_spec_id, context_snapshot_id, compiled_json, prepared_json FROM compiled_generation_requests WHERE project_id = :projectId AND shot_spec_id = :shotSpecId ORDER BY created_at DESC, id DESC").all({ projectId, shotSpecId });
  return (rows as unknown as CompiledRow[]).map(toResult);
}

export function createGenerationCompilerRepository(database: DatabaseSync = getDatabase()) {
  return {
    compile: (projectId: string, shotSpecId: string, input: CompileShotInput) => compileShot(projectId, shotSpecId, input, database),
    get: (projectId: string, compiledRequestId: string) => getCompiledGenerationRequest(compiledRequestId, projectId, database),
    list: (projectId: string, shotSpecId?: string) => listCompiledGenerationRequests(projectId, shotSpecId, database),
  };
}
