import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase } from "./connection";
import { bootstrapDatabase, CURRENT_SCHEMA_VERSION } from "./schema";
import { createDocument, getDocumentRevision } from "./document";
import { createEntity } from "./story-bible";
import { buildContextSnapshot } from "./context-builder";
import { approveStoryboard, createStoryboard } from "./storyboard";
import { compileShot } from "./generation-compiler";
import { getGenerationRecord, retryGenerationJob, submitGeneration } from "./generation";
import { GenerationConflictError } from "./generation-errors";
import { fakeVideoAdapter } from "../media/fake-video-adapter";
import { StoryBibleIdempotencyConflictError, StoryBibleValidationError } from "./story-bible-errors";

type Handle = { database: DatabaseSync; directory: string };
const handles: Handle[] = [];

function isolatedDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "story-phase5c-"));
  const database = createDatabase(join(directory, "story.db"));
  handles.push({ database, directory });
  return database;
}

function insertProject(database: DatabaseSync, title = "Phase 5C") {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  database.prepare("INSERT INTO projects (id, title, premise, genre, status, created_at, updated_at) VALUES (:id, :title, '', '', 'active', :createdAt, :createdAt)").run({ id, title, createdAt });
  return id;
}

function confirmLink(database: DatabaseSync, values: { projectId: string; sceneId: string; sceneRevisionId: string; entityId: string; entityType: "character" | "location" | "prop" }) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const role = values.entityType === "character" ? "appears" : values.entityType === "location" ? "located_at" : "used";
  database.prepare("INSERT INTO scene_entity_links (id, project_id, scene_id, scene_revision_id, entity_id, entity_type, role, status, resolver, confidence, version, candidate_group_id, fingerprint, analysis_run_id, created_at, updated_at) VALUES (:id, :projectId, :sceneId, :sceneRevisionId, :entityId, :entityType, :role, 'confirmed', 'user', 1, 1, :candidateGroupId, :fingerprint, NULL, :createdAt, :createdAt)").run({ id, ...values, role, candidateGroupId: randomUUID(), fingerprint: `phase5c:${id}`, createdAt });
}

function fixture(database: DatabaseSync) {
  const projectId = insertProject(database);
  const character = createEntity(projectId, { type: "character", canonicalName: "Lin" }, database);
  const location = createEntity(projectId, { type: "location", canonicalName: "Hall" }, database);
  const document = createDocument(projectId, { title: "Script", requestId: "phase5c-document", scenes: [{ title: "Entry", content: "Lin enters the hall." }] }, database);
  const revision = getDocumentRevision(document.currentRevisionId as string, projectId, database);
  if (!revision) throw new Error("document revision missing");
  const scene = revision.sceneRevisions[0];
  for (const entity of [character, location] as const) confirmLink(database, { projectId, sceneId: scene.sceneId, sceneRevisionId: scene.id, entityId: entity.id, entityType: entity.type as "character" | "location" | "prop" });
  const snapshot = buildContextSnapshot(projectId, { sceneId: scene.sceneId, sceneRevisionId: scene.id, purpose: "storyboard", policyId: "storyboard-default-v1", requestId: "phase5c-context" }, database).snapshot;
  const board = createStoryboard(projectId, scene.sceneId, {
    contextSnapshotId: snapshot.id,
    title: "Entry",
    shots: [{ ordinal: 1, narrativePurpose: "Establish the entrance", subjects: [{ entityId: character.id, action: "opens the door", expression: "alert", framingRole: "primary" as const }], locationEntityId: location.id, propEntityIds: [], framing: "medium shot", cameraMotion: "slow push-in", lens: "50mm", durationSeconds: 6, dialogueLineIds: [], continuityConstraints: [], negativeConstraints: [] }],
    requestId: "phase5c-board",
  }, database).storyboard;
  const approved = approveStoryboard(projectId, board.id, { expectedVersion: 1, requestId: "phase5c-approve" }, database).storyboard;
  const compiled = compileShot(projectId, approved.shots[0].id, { requestId: "phase5c-compile" }, database).compiledRequest;
  return { projectId, scene, snapshot, board: approved, compiled };
}

afterEach(() => {
  vi.restoreAllMocks();
  while (handles.length > 0) {
    const handle = handles.pop();
    if (!handle) continue;
    handle.database.close();
    rmSync(handle.directory, { recursive: true, force: true });
  }
});

describe("Phase 5C generation manifests and jobs", () => {
  it("upgrades a simulated v16 database additively", () => {
    const database = isolatedDatabase();
    const projectId = insertProject(database);
    database.exec("DROP TRIGGER generation_jobs_delete_guard; DROP TRIGGER fake_provider_submissions_delete_guard; DROP TRIGGER fake_provider_submissions_immutable_guard; DROP TRIGGER fake_provider_submissions_project_guard; DROP TRIGGER generation_results_delete_guard; DROP TRIGGER generation_results_immutable_guard; DROP TRIGGER generation_results_project_guard; DROP TRIGGER generation_jobs_transition_guard; DROP TRIGGER generation_jobs_project_guard; DROP TRIGGER generation_manifests_delete_guard; DROP TRIGGER generation_manifests_immutable_guard; DROP TRIGGER generation_manifests_project_guard; DROP INDEX idx_fake_provider_submissions_project_manifest; DROP TABLE fake_provider_submissions; DROP INDEX idx_generation_results_project_created; DROP TABLE generation_results; DROP INDEX idx_generation_jobs_project_manifest; DROP INDEX idx_generation_jobs_project_status; DROP TABLE generation_jobs; DROP INDEX idx_generation_manifests_project_compiled; DROP INDEX idx_generation_manifests_project_created; DROP TABLE generation_manifests; PRAGMA user_version = 16;");
    bootstrapDatabase(database);
    expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'generation_manifests'").get()).toMatchObject({ name: "generation_manifests" });
    expect(database.prepare("SELECT title FROM projects WHERE id = :projectId").get({ projectId })).toMatchObject({ title: "Phase 5C" });
  });

  it("creates a successful immutable generation and replays only by request id", () => {
    const database = isolatedDatabase();
    const values = fixture(database);
    const input = { compiledRequestId: values.compiled.id, requestId: "generation-one", actorId: "author" };
    const first = submitGeneration(values.projectId, input, database);
    expect(first.idempotent).toBe(false);
    expect(first.job.status).toBe("succeeded");
    expect(first.result?.uri).toMatch(/^fake:\/\/video\/results\//);
    expect(submitGeneration(values.projectId, input, database)).toMatchObject({ idempotent: true, manifest: { id: first.manifest.id }, job: { id: first.job.id }, result: { id: first.result?.id } });
    expect(() => submitGeneration(values.projectId, { ...input, actorId: "different" }, database)).toThrow(StoryBibleIdempotencyConflictError);
    const second = submitGeneration(values.projectId, { compiledRequestId: values.compiled.id, requestId: "generation-two" }, database);
    expect(second.idempotent).toBe(false);
    expect(second.manifest.id).not.toBe(first.manifest.id);
    expect(database.prepare("SELECT COUNT(*) AS count FROM fake_provider_submissions WHERE project_id = :projectId").get({ projectId: values.projectId })).toMatchObject({ count: 2 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE project_id = :projectId AND event_type IN ('generation.requested', 'generation.completed')").get({ projectId: values.projectId })).toMatchObject({ count: 4 });
    expect(getGenerationRecord(first.manifest.id, values.projectId, database)?.result?.resultHash).toBe(first.result?.resultHash);
  });

  it("persists timeout-after-accept exactly once and retries through provider status", () => {
    const database = isolatedDatabase();
    const values = fixture(database);
    const failed = submitGeneration(values.projectId, { compiledRequestId: values.compiled.id, requestId: "generation-timeout", fakeBehavior: "timeout_after_accept_once" }, database);
    expect(failed.job.status).toBe("failed");
    expect(failed.job.error).toMatchObject({ code: "timeout", retryable: true });
    expect(failed.result).toBeNull();
    expect(database.prepare("SELECT COUNT(*) AS count FROM fake_provider_submissions WHERE project_id = :projectId AND job_id = :jobId").get({ projectId: values.projectId, jobId: failed.job.id })).toMatchObject({ count: 1 });
    const retried = retryGenerationJob(values.projectId, failed.job.id, { expectedVersion: failed.job.version, requestId: "generation-timeout-retry" }, database);
    expect(retried.job.status).toBe("succeeded");
    expect(retried.result).not.toBeNull();
    expect(database.prepare("SELECT COUNT(*) AS count FROM fake_provider_submissions WHERE project_id = :projectId AND job_id = :jobId").get({ projectId: values.projectId, jobId: failed.job.id })).toMatchObject({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE project_id = :projectId AND aggregate_id = :jobId AND event_type = 'generation.submitted'").get({ projectId: values.projectId, jobId: failed.job.id })).toMatchObject({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE project_id = :projectId AND aggregate_id = :jobId AND event_type = 'generation.submitted'").get({ projectId: values.projectId, jobId: failed.job.id })).toMatchObject({ count: 1 });
    expect(retryGenerationJob(values.projectId, failed.job.id, { expectedVersion: failed.job.version, requestId: "generation-timeout-retry" }, database)).toMatchObject({ idempotent: true, job: { status: "succeeded" } });
  });

  it("normalizes non-retryable invalid input and rejects retry", () => {
    const database = isolatedDatabase();
    const values = fixture(database);
    const failed = submitGeneration(values.projectId, { compiledRequestId: values.compiled.id, requestId: "generation-invalid", fakeBehavior: "invalid_input" }, database);
    expect(failed.job).toMatchObject({ status: "failed", error: { code: "invalid_input", retryable: false } });
    expect(() => retryGenerationJob(values.projectId, failed.job.id, { expectedVersion: failed.job.version, requestId: "generation-invalid-retry" }, database)).toThrow(StoryBibleValidationError);
  });

  it("enforces retry CAS, terminal success, and cross-project compiled isolation", () => {
    const database = isolatedDatabase();
    const values = fixture(database);
    const secondValues = fixture(database);
    const first = submitGeneration(values.projectId, { compiledRequestId: values.compiled.id, requestId: "generation-cas" }, database);
    expect(() => retryGenerationJob(values.projectId, first.job.id, { expectedVersion: 1, requestId: "generation-stale-retry" }, database)).toThrow(GenerationConflictError);
    expect(() => retryGenerationJob(values.projectId, first.job.id, { expectedVersion: first.job.version, requestId: "generation-illegal-retry" }, database)).toThrow(StoryBibleValidationError);
    expect(() => submitGeneration(values.projectId, { compiledRequestId: secondValues.compiled.id, requestId: "generation-foreign-compiled" }, database)).toThrow();
  });

  it("recovers a running request replay without a second provider submit", () => {
    const database = isolatedDatabase();
    const values = fixture(database);
    const interrupted = vi.spyOn(fakeVideoAdapter, "submit").mockImplementation(() => {
      throw new Error("simulated process interruption after running CAS");
    });
    expect(() => submitGeneration(values.projectId, { compiledRequestId: values.compiled.id, requestId: "generation-running-replay" }, database)).toThrow(/process interruption/);
    interrupted.mockRestore();
    const recovered = submitGeneration(values.projectId, { compiledRequestId: values.compiled.id, requestId: "generation-running-replay" }, database);
    expect(recovered).toMatchObject({ idempotent: true, job: { status: "succeeded", attemptCount: 1 }, result: { provider: "fake-video" } });
    expect(database.prepare("SELECT COUNT(*) AS count FROM fake_provider_submissions WHERE project_id = :projectId").get({ projectId: values.projectId })).toMatchObject({ count: 1 });
  });

  it("rejects raw SQL source-chain mismatches for manifest, result, and provider submission", () => {
    const database = isolatedDatabase();
    const values = fixture(database);
    const first = submitGeneration(values.projectId, { compiledRequestId: values.compiled.id, requestId: "generation-source-base" }, database);
    const manifestRow = database.prepare("SELECT * FROM generation_manifests WHERE id = :id").get({ id: first.manifest.id }) as Record<string, string>;
    const nestedSecretManifest = JSON.parse(manifestRow.manifest_json) as { id: string; manifestHash: string; preparedRequest: { body: Record<string, unknown> } };
    nestedSecretManifest.id = randomUUID();
    nestedSecretManifest.manifestHash = "e".repeat(64);
    nestedSecretManifest.preparedRequest.body.secret = "must not persist";
    expect(() => database.prepare("INSERT INTO generation_manifests (id, project_id, scene_id, storyboard_id, shot_spec_id, context_snapshot_id, compiled_request_id, provider, model, capability_profile_id, capability_profile_version, compiler_version, manifest_json, prepared_json, parameters_json, compiled_hash, manifest_hash, created_by, created_at) VALUES (:id, :projectId, :sceneId, :storyboardId, :shotSpecId, :contextSnapshotId, :compiledRequestId, :provider, :model, :capabilityProfileId, :capabilityProfileVersion, :compilerVersion, :manifestJson, :preparedJson, :parametersJson, :compiledHash, :manifestHash, :createdBy, :createdAt)").run({ id: nestedSecretManifest.id, projectId: values.projectId, sceneId: manifestRow.scene_id, storyboardId: manifestRow.storyboard_id, shotSpecId: manifestRow.shot_spec_id, contextSnapshotId: manifestRow.context_snapshot_id, compiledRequestId: manifestRow.compiled_request_id, provider: manifestRow.provider, model: manifestRow.model, capabilityProfileId: manifestRow.capability_profile_id, capabilityProfileVersion: manifestRow.capability_profile_version, compilerVersion: manifestRow.compiler_version, manifestJson: JSON.stringify(nestedSecretManifest), preparedJson: manifestRow.prepared_json, parametersJson: manifestRow.parameters_json, compiledHash: manifestRow.compiled_hash, manifestHash: nestedSecretManifest.manifestHash, createdBy: manifestRow.created_by, createdAt: new Date().toISOString() })).toThrow();
    const otherDocument = createDocument(values.projectId, { title: "Other", requestId: "phase5c-other-document", scenes: [{ title: "Other scene", content: "Other evidence." }] }, database);
    const otherRevision = getDocumentRevision(otherDocument.currentRevisionId as string, values.projectId, database);
    if (!otherRevision) throw new Error("other revision missing");
    const otherScene = otherRevision.sceneRevisions[0];
    const forgedManifest = JSON.parse(manifestRow.manifest_json) as Record<string, unknown>;
    forgedManifest.id = randomUUID();
    forgedManifest.sceneId = otherScene.sceneId;
    forgedManifest.manifestHash = "f".repeat(64);
    expect(() => database.prepare("INSERT INTO generation_manifests (id, project_id, scene_id, storyboard_id, shot_spec_id, context_snapshot_id, compiled_request_id, provider, model, capability_profile_id, capability_profile_version, compiler_version, manifest_json, prepared_json, parameters_json, compiled_hash, manifest_hash, created_by, created_at) VALUES (:id, :projectId, :sceneId, :storyboardId, :shotSpecId, :contextSnapshotId, :compiledRequestId, :provider, :model, :capabilityProfileId, :capabilityProfileVersion, :compilerVersion, :manifestJson, :preparedJson, :parametersJson, :compiledHash, :manifestHash, :createdBy, :createdAt)").run({ id: forgedManifest.id as string, projectId: values.projectId, sceneId: otherScene.sceneId, storyboardId: manifestRow.storyboard_id, shotSpecId: manifestRow.shot_spec_id, contextSnapshotId: manifestRow.context_snapshot_id, compiledRequestId: manifestRow.compiled_request_id, provider: manifestRow.provider, model: manifestRow.model, capabilityProfileId: manifestRow.capability_profile_id, capabilityProfileVersion: manifestRow.capability_profile_version, compilerVersion: manifestRow.compiler_version, manifestJson: JSON.stringify(forgedManifest), preparedJson: manifestRow.prepared_json, parametersJson: manifestRow.parameters_json, compiledHash: manifestRow.compiled_hash, manifestHash: "f".repeat(64), createdBy: "sql", createdAt: new Date().toISOString() })).toThrow();

    const interrupted = vi.spyOn(fakeVideoAdapter, "submit").mockImplementation(() => {
      throw new Error("stop before provider persistence");
    });
    expect(() => submitGeneration(values.projectId, { compiledRequestId: values.compiled.id, requestId: "generation-source-running" }, database)).toThrow(/stop before/);
    interrupted.mockRestore();
    const running = database.prepare("SELECT m.*, j.id AS job_id FROM generation_manifests m JOIN generation_jobs j ON j.manifest_id = m.id WHERE m.project_id = :projectId AND m.id <> :manifestId ORDER BY m.created_at DESC LIMIT 1").get({ projectId: values.projectId, manifestId: first.manifest.id }) as Record<string, string>;
    const parameters = JSON.parse(running.parameters_json) as { durationSeconds: number; aspectRatio: string; referenceAssetIds: string[] };
    const metadataJson = JSON.stringify({ durationSeconds: parameters.durationSeconds, aspectRatio: parameters.aspectRatio, referenceAssetIds: parameters.referenceAssetIds });
    expect(() => database.prepare("INSERT INTO generation_results (id, project_id, manifest_id, job_id, provider_job_id, provider, model, media_type, uri, metadata_json, result_hash, created_at) VALUES (:id, :projectId, :manifestId, :jobId, 'forged-job', 'fake-video', 'fake-video-model-v1', 'video', 'fake://video/results/forged', :metadataJson, :resultHash, :createdAt)").run({ id: randomUUID(), projectId: values.projectId, manifestId: running.id, jobId: running.job_id, metadataJson, resultHash: "a".repeat(64), createdAt: new Date().toISOString() })).toThrow();
    expect(() => database.prepare("INSERT INTO fake_provider_submissions (id, project_id, manifest_id, job_id, idempotency_key, provider_job_id, behavior, status, prepared_json, raw_result_json, submit_count, created_at, updated_at) VALUES (:id, :projectId, :manifestId, :jobId, :idempotencyKey, 'forged-job', 'success', 'accepted', '{}', '{}', 1, :createdAt, :createdAt)").run({ id: randomUUID(), projectId: values.projectId, manifestId: running.id, jobId: running.job_id, idempotencyKey: `generation:${running.id}`, createdAt: new Date().toISOString() })).toThrow();
  });

  it("enforces immutable rows and project-scoped reads", () => {
    const database = isolatedDatabase();
    const values = fixture(database);
    const result = submitGeneration(values.projectId, { compiledRequestId: values.compiled.id, requestId: "generation-guards" }, database);
    if (!result.result) throw new Error("generation result missing");
    const resultId = result.result.id;
    expect(() => database.prepare("UPDATE generation_manifests SET created_by = 'forged' WHERE id = :id").run({ id: result.manifest.id })).toThrow();
    expect(() => database.prepare("DELETE FROM generation_manifests WHERE id = :id").run({ id: result.manifest.id })).toThrow();
    expect(() => database.prepare("DELETE FROM generation_jobs WHERE id = :id").run({ id: result.job.id })).toThrow();
    expect(() => database.prepare("UPDATE generation_jobs SET status = 'running', version = version + 1, updated_at = :updatedAt WHERE id = :id").run({ id: result.job.id, updatedAt: new Date().toISOString() })).toThrow();
    expect(() => database.prepare("UPDATE generation_results SET uri = 'fake://video/results/forged' WHERE id = :id").run({ id: resultId })).toThrow();
    expect(() => database.prepare("DELETE FROM generation_results WHERE id = :id").run({ id: resultId })).toThrow();
    const foreignProject = insertProject(database, "Foreign");
    expect(getGenerationRecord(result.manifest.id, foreignProject, database)).toBeNull();
  });
});
