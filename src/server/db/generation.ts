import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  canonicalContextJson,
} from "@/domain/context-builder";
import {
  fakePreparedRequestSchema,
  type CompiledGenerationRequest,
  type FakePreparedRequest,
} from "@/domain/generation-compiler";
import {
  generationCommandResultSchema,
  generationJobSchema,
  generationManifestParametersSchema,
  generationManifestSchema,
  generationRecordSchema,
  generationResultSchema,
  normalizedProviderErrorSchema,
  retryGenerationJobInputSchema,
  submitGenerationInputSchema,
  type GenerationCommandResult,
  type GenerationJob,
  type GenerationManifest,
  type GenerationRecord,
  type NormalizedProviderError,
  type ParsedSubmitGenerationInput,
  type RetryGenerationJobInput,
  type SubmitGenerationInput,
} from "@/domain/generation";
import { getDatabase } from "./connection";
import { getCompiledGenerationRequest } from "./generation-compiler";
import { GenerationConflictError } from "./generation-errors";
import { StoryBibleDataIntegrityError, StoryBibleIdempotencyConflictError, StoryBibleNotFoundError, StoryBibleValidationError } from "./story-bible-errors";
import { FakeVideoProviderError, fakeVideoAdapter } from "../media/fake-video-adapter";

type ManifestRow = {
  id: string;
  project_id: string;
  scene_id: string;
  storyboard_id: string;
  shot_spec_id: string;
  context_snapshot_id: string;
  compiled_request_id: string;
  manifest_json: string;
  prepared_json: string;
  parameters_json: string;
  compiled_hash: string;
  manifest_hash: string;
  created_by: string;
  created_at: string;
};
type JobRow = {
  id: string;
  project_id: string;
  manifest_id: string;
  status: GenerationJob["status"];
  version: number;
  attempt_count: number;
  provider_job_id: string | null;
  error_json: string | null;
  created_at: string;
  updated_at: string;
};
type ResultRow = {
  id: string;
  project_id: string;
  manifest_id: string;
  job_id: string;
  provider_job_id: string;
  provider: "fake-video";
  model: "fake-video-model-v1";
  media_type: "video";
  uri: string;
  metadata_json: string;
  result_hash: string;
  created_at: string;
};
type SourceRow = {
  compiled_request_id: string;
  compiled_project_id: string;
  compiled_scene_id: string;
  compiled_shot_spec_id: string;
  compiled_context_snapshot_id: string;
  compiled_hash: string;
  storyboard_id: string;
  storyboard_project_id: string;
  storyboard_scene_id: string;
  storyboard_context_snapshot_id: string;
  storyboard_status: "draft" | "approved" | "superseded";
  storyboard_sealed: number;
  scene_status: "active" | "deleted";
};
type SubmissionRow = {
  project_id: string;
  manifest_id: string;
  job_id: string;
  idempotency_key: string;
  provider_job_id: string;
  behavior: ParsedSubmitGenerationInput["fakeBehavior"];
  prepared_json: string;
  raw_result_json: string | null;
};

const SUBMIT_OPERATION = "generation.submit";
const RETRY_OPERATION = "generation.retry";

function dbFor(database?: DatabaseSync) {
  return database ?? getDatabase();
}

function now() {
  return new Date().toISOString();
}

function nextUpdatedAt(current: string) {
  const candidate = now();
  const currentMillis = Date.parse(current);
  const candidateMillis = Date.parse(candidate);
  return Number.isFinite(currentMillis) && candidateMillis <= currentMillis ? new Date(currentMillis + 1).toISOString() : candidate;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function parseJson(value: string, message: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { throw new StoryBibleDataIntegrityError(message); }
}

function transaction<T>(database: DatabaseSync, operation: () => T) {
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

function requireProject(database: DatabaseSync, projectId: string) {
  if (!database.prepare("SELECT id FROM projects WHERE id = :projectId").get({ projectId })) throw new StoryBibleNotFoundError("Project not found");
}

function manifestRow(database: DatabaseSync, projectId: string, manifestId: string) {
  return database.prepare("SELECT id, project_id, scene_id, storyboard_id, shot_spec_id, context_snapshot_id, compiled_request_id, manifest_json, prepared_json, parameters_json, compiled_hash, manifest_hash, created_by, created_at FROM generation_manifests WHERE id = :manifestId AND project_id = :projectId")
    .get({ manifestId, projectId }) as unknown as ManifestRow | undefined;
}

function jobRow(database: DatabaseSync, projectId: string, jobId: string) {
  return database.prepare("SELECT id, project_id, manifest_id, status, version, attempt_count, provider_job_id, error_json, created_at, updated_at FROM generation_jobs WHERE id = :jobId AND project_id = :projectId")
    .get({ jobId, projectId }) as unknown as JobRow | undefined;
}

function resultRow(database: DatabaseSync, projectId: string, manifestId: string, jobId: string) {
  return database.prepare("SELECT id, project_id, manifest_id, job_id, provider_job_id, provider, model, media_type, uri, metadata_json, result_hash, created_at FROM generation_results WHERE project_id = :projectId AND manifest_id = :manifestId AND job_id = :jobId")
    .get({ projectId, manifestId, jobId }) as unknown as ResultRow | undefined;
}

function sourceRow(database: DatabaseSync, projectId: string, compiledRequestId: string) {
  return database.prepare(`
    SELECT
      c.id AS compiled_request_id,
      c.project_id AS compiled_project_id,
      c.scene_id AS compiled_scene_id,
      c.shot_spec_id AS compiled_shot_spec_id,
      c.context_snapshot_id AS compiled_context_snapshot_id,
      c.compiled_hash,
      sb.id AS storyboard_id,
      sb.project_id AS storyboard_project_id,
      sb.scene_id AS storyboard_scene_id,
      sb.context_snapshot_id AS storyboard_context_snapshot_id,
      sb.status AS storyboard_status,
      sb.sealed AS storyboard_sealed,
      s.status AS scene_status
    FROM compiled_generation_requests c
    JOIN shot_specs ss ON ss.id = c.shot_spec_id
    JOIN storyboards sb ON sb.id = ss.storyboard_id
    JOIN scenes s ON s.id = c.scene_id
    WHERE c.id = :compiledRequestId AND c.project_id = :projectId
  `).get({ compiledRequestId, projectId }) as unknown as SourceRow | undefined;
}

function toManifest(row: ManifestRow): GenerationManifest {
  const parsed = generationManifestSchema.safeParse(parseJson(row.manifest_json, `Invalid Generation Manifest ${row.id}`));
  if (!parsed.success) throw new StoryBibleDataIntegrityError(`Invalid Generation Manifest ${row.id}`);
  const prepared = fakePreparedRequestSchema.parse(parseJson(row.prepared_json, `Invalid prepared request ${row.id}`));
  const parameters = generationManifestParametersSchema.parse(parseJson(row.parameters_json, `Invalid Generation Manifest parameters ${row.id}`));
  if (canonicalContextJson(parsed.data.preparedRequest) !== canonicalContextJson(prepared)
    || canonicalContextJson(parsed.data.parameters) !== canonicalContextJson(parameters)) {
    throw new StoryBibleDataIntegrityError(`Generation Manifest persisted content mismatch ${row.id}`);
  }
  const expectedPreparedHash = sha256(canonicalContextJson({
    provider: prepared.provider,
    model: prepared.model,
    endpoint: prepared.endpoint,
    body: prepared.body,
  }));
  if (prepared.requestHash !== expectedPreparedHash) throw new StoryBibleDataIntegrityError(`Generation Manifest prepared request hash mismatch ${row.id}`);
  const expectedManifestHash = sha256(canonicalContextJson(manifestIdentity({
    projectId: parsed.data.projectId,
    sceneId: parsed.data.sceneId,
    storyboardId: parsed.data.storyboardId,
    shotSpecId: parsed.data.shotSpecId,
    contextSnapshotId: parsed.data.contextSnapshotId,
    compiledRequestId: parsed.data.compiledRequestId,
    provider: parsed.data.provider,
    model: parsed.data.model,
    capabilityProfileId: parsed.data.capabilityProfileId,
    capabilityProfileVersion: parsed.data.capabilityProfileVersion,
    compilerVersion: parsed.data.compilerVersion,
    preparedRequest: prepared,
    parameters,
    compiledHash: parsed.data.compiledHash,
  })));
  if (parsed.data.id !== row.id
    || parsed.data.projectId !== row.project_id
    || parsed.data.sceneId !== row.scene_id
    || parsed.data.storyboardId !== row.storyboard_id
    || parsed.data.shotSpecId !== row.shot_spec_id
    || parsed.data.contextSnapshotId !== row.context_snapshot_id
    || parsed.data.compiledRequestId !== row.compiled_request_id
    || parsed.data.compiledHash !== row.compiled_hash
    || parsed.data.manifestHash !== row.manifest_hash
    || parsed.data.manifestHash !== expectedManifestHash
    || parsed.data.createdBy !== row.created_by
    || parsed.data.createdAt !== row.created_at) {
    throw new StoryBibleDataIntegrityError(`Generation Manifest identity or hash mismatch ${row.id}`);
  }
  return parsed.data;
}

function toJob(row: JobRow): GenerationJob {
  const error = row.error_json === null ? null : normalizedProviderErrorSchema.safeParse(parseJson(row.error_json, `Invalid Generation Job error ${row.id}`));
  if (row.error_json !== null && (!error || !error.success)) throw new StoryBibleDataIntegrityError(`Invalid Generation Job error ${row.id}`);
  return generationJobSchema.parse({ id: row.id, projectId: row.project_id, manifestId: row.manifest_id, status: row.status, version: row.version, attemptCount: row.attempt_count, providerJobId: row.provider_job_id, error: error && error.success ? error.data : null, createdAt: row.created_at, updatedAt: row.updated_at });
}

function resultHash(values: { manifestId: string; jobId: string; providerJobId: string; provider: string; model: string; mediaType: string; uri: string; metadata: unknown }) {
  return sha256(canonicalContextJson(values));
}

function toResult(row: ResultRow): NonNullable<GenerationRecord["result"]> {
  const metadata = parseJson(row.metadata_json, `Invalid Generation Result metadata ${row.id}`);
  const result = generationResultSchema.parse({ id: row.id, projectId: row.project_id, manifestId: row.manifest_id, jobId: row.job_id, providerJobId: row.provider_job_id, provider: row.provider, model: row.model, mediaType: row.media_type, uri: row.uri, metadata, resultHash: row.result_hash, createdAt: row.created_at });
  if (result.resultHash !== resultHash({ manifestId: result.manifestId, jobId: result.jobId, providerJobId: result.providerJobId, provider: result.provider, model: result.model, mediaType: result.mediaType, uri: result.uri, metadata: result.metadata })) throw new StoryBibleDataIntegrityError(`Generation Result hash mismatch ${row.id}`);
  return result;
}

function recordByManifestId(database: DatabaseSync, projectId: string, manifestId: string): GenerationRecord | null {
  const manifest = manifestRow(database, projectId, manifestId);
  if (!manifest) return null;
  const job = database.prepare("SELECT id, project_id, manifest_id, status, version, attempt_count, provider_job_id, error_json, created_at, updated_at FROM generation_jobs WHERE project_id = :projectId AND manifest_id = :manifestId").get({ projectId, manifestId }) as unknown as JobRow | undefined;
  if (!job) throw new StoryBibleDataIntegrityError(`Generation Job is missing for Manifest ${manifestId}`);
  const result = resultRow(database, projectId, manifestId, job.id);
  return generationRecordSchema.parse({ manifest: toManifest(manifest), job: toJob(job), result: result ? toResult(result) : null });
}

function requestFingerprint(projectId: string, operation: string, resourceId: string, input: unknown) {
  return sha256(canonicalContextJson({ projectId, operation, resourceId, input }));
}

function idempotencyRow(database: DatabaseSync, projectId: string, operation: string, requestId: string) {
  return database.prepare("SELECT resource_id, response_json FROM idempotency_keys WHERE project_id = :projectId AND operation = :operation AND request_id = :requestId")
    .get({ projectId, operation, requestId }) as { resource_id: string; response_json: string } | undefined;
}

function storeIdempotency(database: DatabaseSync, values: { projectId: string; operation: string; requestId: string; resourceType: string; resourceId: string; fingerprint: string; createdAt: string }) {
  database.prepare("INSERT INTO idempotency_keys (id, project_id, operation, request_id, resource_type, resource_id, response_json, created_at) VALUES (:id, :projectId, :operation, :requestId, :resourceType, :resourceId, :responseJson, :createdAt)")
    .run({ id: randomUUID(), projectId: values.projectId, operation: values.operation, requestId: values.requestId, resourceType: values.resourceType, resourceId: values.resourceId, responseJson: JSON.stringify({ manifestId: values.resourceType === "generation_manifest" ? values.resourceId : undefined, jobId: values.resourceType === "generation_job" ? values.resourceId : undefined, requestFingerprint: values.fingerprint }), createdAt: values.createdAt });
}

function replayTarget(database: DatabaseSync, projectId: string, duplicate: { resource_id: string; response_json: string }, fingerprint: string) {
  const stored = parseJson(duplicate.response_json, "Stored Generation idempotency response is invalid") as { manifestId?: string; jobId?: string; requestFingerprint?: string };
  if (stored.requestFingerprint !== fingerprint) throw new StoryBibleIdempotencyConflictError();
  const manifestId = stored.manifestId ?? (stored.jobId ? (jobRow(database, projectId, stored.jobId)?.manifest_id ?? null) : null);
  if (!manifestId) throw new StoryBibleDataIntegrityError("Idempotent Generation resource is missing");
  const jobId = stored.jobId ?? (database.prepare("SELECT id FROM generation_jobs WHERE project_id = :projectId AND manifest_id = :manifestId").get({ projectId, manifestId }) as { id?: string } | undefined)?.id;
  if (!jobId) throw new StoryBibleDataIntegrityError("Idempotent Generation Job is missing");
  if (!recordByManifestId(database, projectId, manifestId)) throw new StoryBibleDataIntegrityError("Idempotent Generation Manifest is missing");
  return { manifestId, jobId };
}

function commandForRecord(database: DatabaseSync, projectId: string, manifestId: string, idempotent: boolean): GenerationCommandResult {
  const record = recordByManifestId(database, projectId, manifestId);
  if (!record) throw new StoryBibleDataIntegrityError("Generation record is missing");
  return generationCommandResultSchema.parse({ ...record, idempotent });
}

function resumeOrReplay(database: DatabaseSync, projectId: string, target: { manifestId: string; jobId: string }): GenerationCommandResult {
  const current = recordByManifestId(database, projectId, target.manifestId);
  if (!current) throw new StoryBibleDataIntegrityError("Idempotent Generation Manifest is missing");
  if (current.job.status === "queued" || current.job.status === "running") {
    const resumed = executeGenerationJob(projectId, target.jobId, database);
    return generationCommandResultSchema.parse({ ...resumed, idempotent: true });
  }
  return commandForRecord(database, projectId, target.manifestId, true);
}

function writeEvent(database: DatabaseSync, values: { projectId: string; eventType: string; aggregateType: string; aggregateId: string; aggregateVersion: number; payload: Record<string, unknown>; actorId: string; requestId: string }) {
  const createdAt = now();
  const payloadJson = canonicalContextJson(values.payload);
  database.prepare("INSERT INTO audit_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, actor_id, request_id, created_at) VALUES (:id, :projectId, :eventType, :aggregateType, :aggregateId, :aggregateVersion, :payloadJson, :actorId, :requestId, :createdAt)")
    .run({ id: randomUUID(), projectId: values.projectId, eventType: values.eventType, aggregateType: values.aggregateType, aggregateId: values.aggregateId, aggregateVersion: values.aggregateVersion, payloadJson, actorId: values.actorId, requestId: values.requestId, createdAt });
  database.prepare("INSERT INTO outbox_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, request_id, status, attempts, available_at, published_at, created_at) VALUES (:id, :projectId, :eventType, :aggregateType, :aggregateId, :aggregateVersion, :payloadJson, :requestId, 'pending', 0, :availableAt, NULL, :createdAt)")
    .run({ id: randomUUID(), projectId: values.projectId, eventType: values.eventType, aggregateType: values.aggregateType, aggregateId: values.aggregateId, aggregateVersion: values.aggregateVersion, payloadJson, requestId: values.requestId, availableAt: createdAt, createdAt });
}

function manifestIdentity(values: { projectId: string; sceneId: string; storyboardId: string; shotSpecId: string; contextSnapshotId: string; compiledRequestId: string; provider: string; model: string; capabilityProfileId: string; capabilityProfileVersion: string; compilerVersion: string; preparedRequest: FakePreparedRequest; parameters: unknown; compiledHash: string }) {
  return values;
}

function makeManifest(projectId: string, source: SourceRow, compiledRequest: CompiledGenerationRequest, preparedRequest: FakePreparedRequest, input: ParsedSubmitGenerationInput): GenerationManifest {
  const parameters = generationManifestParametersSchema.parse({ ...compiledRequest.parameters, referenceAssetIds: compiledRequest.assetInputs.map((asset) => asset.assetId), fakeBehavior: input.fakeBehavior });
  const identity = manifestIdentity({ projectId, sceneId: source.compiled_scene_id, storyboardId: source.storyboard_id, shotSpecId: source.compiled_shot_spec_id, contextSnapshotId: source.compiled_context_snapshot_id, compiledRequestId: compiledRequest.id, provider: compiledRequest.provider, model: compiledRequest.model, capabilityProfileId: compiledRequest.capabilityProfileId, capabilityProfileVersion: compiledRequest.capabilityProfileVersion, compilerVersion: compiledRequest.compilerVersion, preparedRequest, parameters, compiledHash: compiledRequest.compiledHash });
  const manifestHash = sha256(canonicalContextJson(identity));
  return generationManifestSchema.parse({ id: randomUUID(), projectId, sceneId: source.compiled_scene_id, storyboardId: source.storyboard_id, shotSpecId: source.compiled_shot_spec_id, contextSnapshotId: source.compiled_context_snapshot_id, compiledRequestId: compiledRequest.id, provider: compiledRequest.provider, model: compiledRequest.model, capabilityProfileId: compiledRequest.capabilityProfileId, capabilityProfileVersion: compiledRequest.capabilityProfileVersion, compilerVersion: compiledRequest.compilerVersion, preparedRequest, parameters, compiledHash: compiledRequest.compiledHash, manifestHash, createdBy: input.actorId, createdAt: now() });
}

function insertManifestAndJob(database: DatabaseSync, projectId: string, manifest: GenerationManifest, fingerprint: string, input: ParsedSubmitGenerationInput) {
  database.prepare("INSERT INTO generation_manifests (id, project_id, scene_id, storyboard_id, shot_spec_id, context_snapshot_id, compiled_request_id, provider, model, capability_profile_id, capability_profile_version, compiler_version, manifest_json, prepared_json, parameters_json, compiled_hash, manifest_hash, created_by, created_at) VALUES (:id, :projectId, :sceneId, :storyboardId, :shotSpecId, :contextSnapshotId, :compiledRequestId, :provider, :model, :capabilityProfileId, :capabilityProfileVersion, :compilerVersion, :manifestJson, :preparedJson, :parametersJson, :compiledHash, :manifestHash, :createdBy, :createdAt)")
    .run({ id: manifest.id, projectId, sceneId: manifest.sceneId, storyboardId: manifest.storyboardId, shotSpecId: manifest.shotSpecId, contextSnapshotId: manifest.contextSnapshotId, compiledRequestId: manifest.compiledRequestId, provider: manifest.provider, model: manifest.model, capabilityProfileId: manifest.capabilityProfileId, capabilityProfileVersion: manifest.capabilityProfileVersion, compilerVersion: manifest.compilerVersion, manifestJson: JSON.stringify(manifest), preparedJson: JSON.stringify(manifest.preparedRequest), parametersJson: JSON.stringify(manifest.parameters), compiledHash: manifest.compiledHash, manifestHash: manifest.manifestHash, createdBy: manifest.createdBy, createdAt: manifest.createdAt });
  const jobId = randomUUID();
  database.prepare("INSERT INTO generation_jobs (id, project_id, manifest_id, status, version, attempt_count, provider_job_id, error_json, created_at, updated_at) VALUES (:id, :projectId, :manifestId, 'queued', 1, 0, NULL, NULL, :createdAt, :createdAt)")
    .run({ id: jobId, projectId, manifestId: manifest.id, createdAt: manifest.createdAt });
  storeIdempotency(database, { projectId, operation: SUBMIT_OPERATION, requestId: input.requestId, resourceType: "generation_manifest", resourceId: manifest.id, fingerprint, createdAt: manifest.createdAt });
  writeEvent(database, { projectId, eventType: "generation.requested", aggregateType: "generation_manifest", aggregateId: manifest.id, aggregateVersion: 1, payload: { compiledRequestId: manifest.compiledRequestId, shotSpecId: manifest.shotSpecId, jobId }, actorId: input.actorId, requestId: input.requestId });
  return jobId;
}

function validateSource(source: SourceRow, projectId: string) {
  if (source.compiled_project_id !== projectId || source.storyboard_project_id !== projectId || source.storyboard_scene_id !== source.compiled_scene_id || source.storyboard_context_snapshot_id !== source.compiled_context_snapshot_id) throw new StoryBibleValidationError("Generation source chain does not belong to this project", ["compiledRequestId"]);
  if (source.scene_status !== "active") throw new StoryBibleValidationError("Generation requires an active Scene", ["compiledRequestId"]);
  if (source.storyboard_status !== "approved" || source.storyboard_sealed !== 1) throw new StoryBibleValidationError("Generation requires an approved sealed Storyboard", ["compiledRequestId"]);
}

export function getGenerationRecord(manifestId: string, projectId: string, database?: DatabaseSync) {
  const databaseHandle = dbFor(database);
  requireProject(databaseHandle, projectId);
  return recordByManifestId(databaseHandle, projectId, manifestId);
}

export function submitGeneration(projectId: string, input: SubmitGenerationInput, database?: DatabaseSync): GenerationCommandResult {
  const values = submitGenerationInputSchema.parse(input);
  const databaseHandle = dbFor(database);
  const prepared = transaction(databaseHandle, () => {
    requireProject(databaseHandle, projectId);
    const fingerprint = requestFingerprint(projectId, SUBMIT_OPERATION, values.compiledRequestId, values);
    const duplicate = idempotencyRow(databaseHandle, projectId, SUBMIT_OPERATION, values.requestId);
    if (duplicate) return { replayTarget: replayTarget(databaseHandle, projectId, duplicate, fingerprint) };
    const source = sourceRow(databaseHandle, projectId, values.compiledRequestId);
    if (!source) throw new StoryBibleNotFoundError("Compiled generation request not found");
    validateSource(source, projectId);
    const compiled = getCompiledGenerationRequest(values.compiledRequestId, projectId, databaseHandle);
    if (!compiled) throw new StoryBibleNotFoundError("Compiled generation request not found");
    const manifest = makeManifest(projectId, source, compiled.compiledRequest, compiled.preview, values);
    const jobId = insertManifestAndJob(databaseHandle, projectId, manifest, fingerprint, values);
    return { manifestId: manifest.id, jobId };
  });
  if ("replayTarget" in prepared && prepared.replayTarget) return resumeOrReplay(databaseHandle, projectId, prepared.replayTarget);
  return executeGenerationJob(projectId, prepared.jobId, databaseHandle, false);
}

function submissionForJob(database: DatabaseSync, projectId: string, jobId: string) {
  return database.prepare("SELECT project_id, manifest_id, job_id, idempotency_key, provider_job_id, behavior, prepared_json, raw_result_json FROM fake_provider_submissions WHERE project_id = :projectId AND job_id = :jobId").get({ projectId, jobId }) as unknown as SubmissionRow | undefined;
}

function recordProviderSubmission(projectId: string, jobId: string, input: { actorId: string; requestId: string }, database: DatabaseSync) {
  return transaction(database, () => {
    const submission = submissionForJob(database, projectId, jobId);
    if (!submission) throw new StoryBibleDataIntegrityError("Fake provider submission is missing");
    const current = jobRow(database, projectId, jobId);
    if (!current || current.manifest_id !== submission.manifest_id) throw new StoryBibleDataIntegrityError("Fake provider submission does not match its Generation Job");
    const auditExists = Boolean(database.prepare("SELECT 1 FROM audit_events WHERE project_id = :projectId AND event_type = 'generation.submitted' AND aggregate_type = 'generation_job' AND aggregate_id = :jobId LIMIT 1").get({ projectId, jobId }));
    const outboxExists = Boolean(database.prepare("SELECT 1 FROM outbox_events WHERE project_id = :projectId AND event_type = 'generation.submitted' AND aggregate_type = 'generation_job' AND aggregate_id = :jobId LIMIT 1").get({ projectId, jobId }));
    if (auditExists !== outboxExists) throw new StoryBibleDataIntegrityError("Generation submission event pair is incomplete");
    if (!auditExists) {
      writeEvent(database, {
        projectId,
        eventType: "generation.submitted",
        aggregateType: "generation_job",
        aggregateId: jobId,
        aggregateVersion: current.version,
        payload: {
          manifestId: submission.manifest_id,
          providerJobId: submission.provider_job_id,
          idempotencyKey: submission.idempotency_key,
        },
        actorId: input.actorId,
        requestId: input.requestId,
      });
    }
    return submission;
  });
}

function transitionQueuedToRunning(projectId: string, jobId: string, input: { actorId: string; requestId: string }, database: DatabaseSync) {
  return transaction(database, () => {
    const current = jobRow(database, projectId, jobId);
    if (!current) throw new StoryBibleNotFoundError("Generation Job not found");
    if (current.status !== "queued") return current;
    const updatedAt = nextUpdatedAt(current.updated_at);
    const changed = database.prepare("UPDATE generation_jobs SET status = 'running', version = version + 1, attempt_count = attempt_count + 1, updated_at = :updatedAt WHERE id = :jobId AND project_id = :projectId AND status = 'queued' AND version = :version").run({ jobId, projectId, version: current.version, updatedAt });
    if (changed.changes !== 1) return jobRow(database, projectId, jobId) as JobRow;
    const updated = jobRow(database, projectId, jobId);
    if (!updated) throw new StoryBibleDataIntegrityError("Running Generation Job is missing");
    writeEvent(database, { projectId, eventType: "generation.started", aggregateType: "generation_job", aggregateId: jobId, aggregateVersion: updated.version, payload: { manifestId: updated.manifest_id, attemptCount: updated.attempt_count }, actorId: input.actorId, requestId: input.requestId });
    return updated;
  });
}

function terminalFailure(projectId: string, jobId: string, error: NormalizedProviderError, providerJobId: string | null, input: { actorId: string; requestId: string }, database: DatabaseSync) {
  return transaction(database, () => {
    const current = jobRow(database, projectId, jobId);
    if (!current) throw new StoryBibleNotFoundError("Generation Job not found");
    if (current.status === "failed" || current.status === "succeeded") return current;
    if (current.status !== "running") throw new StoryBibleValidationError("Generation Job is not running", ["status"]);
    const normalized = normalizedProviderErrorSchema.parse(error);
    const updatedAt = nextUpdatedAt(current.updated_at);
    const changed = database.prepare("UPDATE generation_jobs SET status = 'failed', version = version + 1, provider_job_id = :providerJobId, error_json = :errorJson, updated_at = :updatedAt WHERE id = :jobId AND project_id = :projectId AND status = 'running' AND version = :version").run({ jobId, projectId, version: current.version, providerJobId, errorJson: canonicalContextJson(normalized), updatedAt });
    if (changed.changes !== 1) throw new GenerationConflictError(recordByManifestId(database, projectId, current.manifest_id) as GenerationRecord);
    const updated = jobRow(database, projectId, jobId);
    if (!updated) throw new StoryBibleDataIntegrityError("Failed Generation Job is missing");
    writeEvent(database, { projectId, eventType: "generation.failed", aggregateType: "generation_job", aggregateId: jobId, aggregateVersion: updated.version, payload: { manifestId: updated.manifest_id, error: normalized, providerJobId }, actorId: input.actorId, requestId: input.requestId });
    return updated;
  });
}

function terminalSuccess(projectId: string, jobId: string, providerJobId: string, result: ReturnType<typeof fakeVideoAdapter.normalizeResult>, input: { actorId: string; requestId: string }, database: DatabaseSync) {
  return transaction(database, () => {
    const current = jobRow(database, projectId, jobId);
    if (!current) throw new StoryBibleNotFoundError("Generation Job not found");
    if (current.status === "succeeded") return current;
    if (current.status !== "running") throw new StoryBibleValidationError("Generation Job is not running", ["status"]);
    const resultId = randomUUID();
    const createdAt = now();
    const resultHashValue = resultHash({ manifestId: current.manifest_id, jobId, providerJobId, provider: result.provider, model: result.model, mediaType: result.mediaType, uri: result.uri, metadata: result.metadata });
    database.prepare("INSERT INTO generation_results (id, project_id, manifest_id, job_id, provider_job_id, provider, model, media_type, uri, metadata_json, result_hash, created_at) VALUES (:id, :projectId, :manifestId, :jobId, :providerJobId, :provider, :model, :mediaType, :uri, :metadataJson, :resultHash, :createdAt)")
      .run({ id: resultId, projectId, manifestId: current.manifest_id, jobId, providerJobId, provider: result.provider, model: result.model, mediaType: result.mediaType, uri: result.uri, metadataJson: canonicalContextJson(result.metadata), resultHash: resultHashValue, createdAt });
    const updatedAt = nextUpdatedAt(current.updated_at);
    const changed = database.prepare("UPDATE generation_jobs SET status = 'succeeded', version = version + 1, provider_job_id = :providerJobId, error_json = NULL, updated_at = :updatedAt WHERE id = :jobId AND project_id = :projectId AND status = 'running' AND version = :version").run({ jobId, projectId, version: current.version, providerJobId, updatedAt });
    if (changed.changes !== 1) throw new GenerationConflictError(recordByManifestId(database, projectId, current.manifest_id) as GenerationRecord);
    const updated = jobRow(database, projectId, jobId);
    if (!updated) throw new StoryBibleDataIntegrityError("Succeeded Generation Job is missing");
    writeEvent(database, { projectId, eventType: "generation.completed", aggregateType: "generation_job", aggregateId: jobId, aggregateVersion: updated.version, payload: { manifestId: updated.manifest_id, resultId, providerJobId }, actorId: input.actorId, requestId: input.requestId });
    return updated;
  });
}

export function executeGenerationJob(projectId: string, jobId: string, database?: DatabaseSync, useRequestId = false): GenerationCommandResult {
  const databaseHandle = dbFor(database);
  const before = jobRow(databaseHandle, projectId, jobId);
  if (!before) throw new StoryBibleNotFoundError("Generation Job not found");
  if (before.status === "succeeded" || before.status === "failed") {
    const record = recordByManifestId(databaseHandle, projectId, before.manifest_id);
    if (!record) throw new StoryBibleDataIntegrityError("Generation record is missing");
    return generationCommandResultSchema.parse({ ...record, idempotent: false });
  }
  const request = { actorId: "system", requestId: useRequestId ? randomUUID() : `generation-execute:${jobId}:${before.version + 1}` };
  const running = transitionQueuedToRunning(projectId, jobId, request, databaseHandle);
  if (running.status !== "running") {
    const record = recordByManifestId(databaseHandle, projectId, running.manifest_id);
    if (!record) throw new StoryBibleDataIntegrityError("Generation record is missing");
    return generationCommandResultSchema.parse({ ...record, idempotent: false });
  }
  const record = recordByManifestId(databaseHandle, projectId, running.manifest_id);
  if (!record) throw new StoryBibleDataIntegrityError("Generation record is missing");
  const submission = submissionForJob(databaseHandle, projectId, jobId);
  try {
    const providerRef = submission
      ? { provider: "fake-video" as const, providerJobId: submission.provider_job_id, idempotencyKey: submission.idempotency_key }
      : fakeVideoAdapter.submit(record.manifest.preparedRequest, { projectId, manifestId: record.manifest.id, jobId, idempotencyKey: `generation:${record.manifest.id}`, behavior: record.manifest.parameters.fakeBehavior, database: databaseHandle });
    recordProviderSubmission(projectId, jobId, request, databaseHandle);
    const status = fakeVideoAdapter.getStatus(providerRef, databaseHandle, projectId);
    if (status.status === "failed") {
      const failed = terminalFailure(projectId, jobId, status.error, providerRef.providerJobId, request, databaseHandle);
      const finalRecord = recordByManifestId(databaseHandle, projectId, failed.manifest_id);
      if (!finalRecord) throw new StoryBibleDataIntegrityError("Failed Generation record is missing");
      return generationCommandResultSchema.parse({ ...finalRecord, idempotent: false });
    }
    if (status.status !== "succeeded") return generationCommandResultSchema.parse({ ...recordByManifestId(databaseHandle, projectId, running.manifest_id), idempotent: false });
    const normalized = fakeVideoAdapter.normalizeResult(status.rawResult);
    const succeeded = terminalSuccess(projectId, jobId, providerRef.providerJobId, normalized, request, databaseHandle);
    const finalRecord = recordByManifestId(databaseHandle, projectId, succeeded.manifest_id);
    if (!finalRecord) throw new StoryBibleDataIntegrityError("Succeeded Generation record is missing");
    return generationCommandResultSchema.parse({ ...finalRecord, idempotent: false });
  } catch (error) {
    if (error instanceof FakeVideoProviderError) {
      if (error.providerJobId) recordProviderSubmission(projectId, jobId, request, databaseHandle);
      const failed = terminalFailure(projectId, jobId, error.normalized, error.providerJobId, request, databaseHandle);
      const finalRecord = recordByManifestId(databaseHandle, projectId, failed.manifest_id);
      if (!finalRecord) throw new StoryBibleDataIntegrityError("Failed Generation record is missing");
      return generationCommandResultSchema.parse({ ...finalRecord, idempotent: false });
    }
    throw error;
  }
}

export function retryGenerationJob(projectId: string, jobId: string, input: RetryGenerationJobInput, database?: DatabaseSync): GenerationCommandResult {
  const values = retryGenerationJobInputSchema.parse(input);
  const databaseHandle = dbFor(database);
  const prepared = transaction(databaseHandle, () => {
    requireProject(databaseHandle, projectId);
    const current = jobRow(databaseHandle, projectId, jobId);
    if (!current) throw new StoryBibleNotFoundError("Generation Job not found");
    const currentRecord = recordByManifestId(databaseHandle, projectId, current.manifest_id);
    if (!currentRecord) throw new StoryBibleDataIntegrityError("Generation record is missing");
    const fingerprint = requestFingerprint(projectId, RETRY_OPERATION, jobId, values);
    const duplicate = idempotencyRow(databaseHandle, projectId, RETRY_OPERATION, values.requestId);
    if (duplicate) return { replayTarget: replayTarget(databaseHandle, projectId, duplicate, fingerprint) };
    if (current.version !== values.expectedVersion) throw new GenerationConflictError(currentRecord);
    if (current.status !== "failed") throw new StoryBibleValidationError("Only a failed Generation Job can be retried", ["status"]);
    const storedError = current.error_json === null ? null : normalizedProviderErrorSchema.safeParse(parseJson(current.error_json, "Stored Generation Job error is invalid"));
    if (!storedError || !storedError.success) throw new StoryBibleDataIntegrityError("Stored Generation Job error is invalid");
    if (!storedError.data.retryable) throw new StoryBibleValidationError("This Generation Job failure is not retryable", ["error"]);
    const updatedAt = nextUpdatedAt(current.updated_at);
    const changed = databaseHandle.prepare("UPDATE generation_jobs SET status = 'queued', version = version + 1, error_json = NULL, updated_at = :updatedAt WHERE id = :jobId AND project_id = :projectId AND status = 'failed' AND version = :version").run({ jobId, projectId, version: current.version, updatedAt });
    if (changed.changes !== 1) throw new GenerationConflictError(recordByManifestId(databaseHandle, projectId, current.manifest_id) as GenerationRecord);
    const updated = jobRow(databaseHandle, projectId, jobId);
    if (!updated) throw new StoryBibleDataIntegrityError("Queued Generation Job is missing");
    storeIdempotency(databaseHandle, { projectId, operation: RETRY_OPERATION, requestId: values.requestId, resourceType: "generation_job", resourceId: jobId, fingerprint, createdAt: updatedAt });
    writeEvent(databaseHandle, { projectId, eventType: "generation.retry.queued", aggregateType: "generation_job", aggregateId: jobId, aggregateVersion: updated.version, payload: { manifestId: current.manifest_id, expectedVersion: values.expectedVersion }, actorId: values.actorId, requestId: values.requestId });
    return { jobId };
  });
  if ("replayTarget" in prepared && prepared.replayTarget) return resumeOrReplay(databaseHandle, projectId, prepared.replayTarget);
  return executeGenerationJob(projectId, prepared.jobId, databaseHandle);
}

export function createGenerationRepository(database: DatabaseSync = getDatabase()) {
  return {
    submit: (projectId: string, input: SubmitGenerationInput) => submitGeneration(projectId, input, database),
    get: (projectId: string, manifestId: string) => getGenerationRecord(manifestId, projectId, database),
    execute: (projectId: string, jobId: string) => executeGenerationJob(projectId, jobId, database),
    retry: (projectId: string, jobId: string, input: RetryGenerationJobInput) => retryGenerationJob(projectId, jobId, input, database),
  };
}
