import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  compiledGenerationRequestSchema,
  fakePreparedRequestSchema,
  type CompiledGenerationRequest,
  type FakePreparedRequest,
} from "@/domain/generation-compiler";
import {
  fakeGenerationBehaviorSchema,
  fakeProviderJobRefSchema,
  fakeRawResultSchema,
  normalizedMediaResultSchema,
  normalizedProviderErrorSchema,
  normalizedProviderJobStatusSchema,
  type FakeGenerationBehavior,
  type FakeProviderJobRef,
  type FakeRawResult,
  type NormalizedMediaResult,
  type NormalizedProviderError,
  type NormalizedProviderJobStatus,
} from "@/domain/generation";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
  }
  return value;
}
function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export type FakeVideoValidationResult =
  | { valid: true }
  | { valid: false; issues: string[] };

export class FakeVideoProviderError extends Error {
  readonly normalized: NormalizedProviderError;
  readonly providerJobId: string | null;

  constructor(normalized: NormalizedProviderError, providerJobId: string | null = null) {
    super(normalized.message);
    this.name = "FakeVideoProviderError";
    this.normalized = normalizedProviderErrorSchema.parse(normalized);
    this.providerJobId = providerJobId;
  }
}

export type SubmissionOptions = {
  projectId: string;
  manifestId: string;
  jobId: string;
  idempotencyKey: string;
  behavior: FakeGenerationBehavior;
  database: DatabaseSync;
};

type SubmissionRow = {
  project_id: string;
  manifest_id: string;
  job_id: string;
  idempotency_key: string;
  provider_job_id: string;
  behavior: FakeGenerationBehavior;
  status: "accepted";
  prepared_json: string;
  raw_result_json: string | null;
};

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

function parseJson(value: string, message: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { throw new Error(message); }
}

export class FakeVideoAdapter {
  validate(request: unknown): FakeVideoValidationResult {
    const parsed = compiledGenerationRequestSchema.safeParse(request);
    if (!parsed.success) return { valid: false, issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
    if (parsed.data.promptSegments.map((segment) => segment.text).join("\n").length > 4_000) {
      return { valid: false, issues: ["prompt exceeds the fake-video 4000 character limit"] };
    }
    return { valid: true };
  }

  prepare(request: CompiledGenerationRequest): FakePreparedRequest {
    const parsed = compiledGenerationRequestSchema.parse(request);
    const body = {
      prompt: parsed.promptSegments.map((segment) => segment.text).join("\n"),
      negativePrompt: parsed.negativePrompt,
      referenceAssetIds: parsed.assetInputs.map((asset) => asset.assetId),
      durationSeconds: parsed.parameters.durationSeconds,
      aspectRatio: parsed.parameters.aspectRatio,
    };
    return fakePreparedRequestSchema.parse({
      provider: parsed.provider,
      model: parsed.model,
      endpoint: "fake://video/generate",
      body,
      requestHash: sha256(canonicalJson({ provider: parsed.provider, model: parsed.model, endpoint: "fake://video/generate", body })),
    });
  }

  submit(preparedRequest: FakePreparedRequest, options: SubmissionOptions): FakeProviderJobRef {
    const behavior = fakeGenerationBehaviorSchema.parse(options.behavior);
    const existing = options.database.prepare("SELECT project_id, manifest_id, job_id, idempotency_key, provider_job_id, behavior, status, prepared_json, raw_result_json FROM fake_provider_submissions WHERE project_id = :projectId AND idempotency_key = :idempotencyKey")
      .get({ projectId: options.projectId, idempotencyKey: options.idempotencyKey }) as unknown as SubmissionRow | undefined;
    if (existing) {
      if (existing.manifest_id !== options.manifestId || existing.job_id !== options.jobId || canonicalJson(parseJson(existing.prepared_json, "Stored fake prepared request is invalid")) !== canonicalJson(preparedRequest)) {
        throw new FakeVideoProviderError({ code: "unknown", message: "Fake provider idempotency key was bound to different input.", retryable: false }, existing.provider_job_id);
      }
      return fakeProviderJobRefSchema.parse({ provider: "fake-video", providerJobId: existing.provider_job_id, idempotencyKey: existing.idempotency_key });
    }
    if (behavior === "invalid_input") {
      throw new FakeVideoProviderError({ code: "invalid_input", message: "The fake provider rejected this prepared request.", retryable: false });
    }
    const providerJobId = `fake-job-${sha256(options.idempotencyKey).slice(0, 48)}`;
    const rawResult: FakeRawResult = fakeRawResultSchema.parse({
      providerJobId,
      uri: `fake://video/results/${sha256(`${options.idempotencyKey}:result`).slice(0, 48)}`,
      durationSeconds: preparedRequest.body.durationSeconds,
      aspectRatio: preparedRequest.body.aspectRatio,
      referenceAssetIds: preparedRequest.body.referenceAssetIds,
    });
    const createdAt = new Date().toISOString();
    transaction(options.database, () => {
      options.database.prepare("INSERT INTO fake_provider_submissions (id, project_id, manifest_id, job_id, idempotency_key, provider_job_id, behavior, status, prepared_json, raw_result_json, submit_count, created_at, updated_at) VALUES (:id, :projectId, :manifestId, :jobId, :idempotencyKey, :providerJobId, :behavior, 'accepted', :preparedJson, :rawResultJson, 1, :createdAt, :createdAt)")
        .run({ id: randomUUID(), projectId: options.projectId, manifestId: options.manifestId, jobId: options.jobId, idempotencyKey: options.idempotencyKey, providerJobId, behavior, preparedJson: canonicalJson(preparedRequest), rawResultJson: canonicalJson(rawResult), createdAt });
    });
    const jobRef = fakeProviderJobRefSchema.parse({ provider: "fake-video", providerJobId, idempotencyKey: options.idempotencyKey });
    if (behavior === "timeout_after_accept_once") {
      throw new FakeVideoProviderError({ code: "timeout", message: "The fake provider accepted the request but the first response timed out.", retryable: true }, providerJobId);
    }
    return jobRef;
  }

  getStatus(jobRef: FakeProviderJobRef, database: DatabaseSync, projectId: string): NormalizedProviderJobStatus {
    const ref = fakeProviderJobRefSchema.parse(jobRef);
    const row = database.prepare("SELECT project_id, manifest_id, job_id, idempotency_key, provider_job_id, behavior, status, prepared_json, raw_result_json FROM fake_provider_submissions WHERE idempotency_key = :idempotencyKey AND provider_job_id = :providerJobId AND (:projectId IS NULL OR project_id = :projectId)")
      .get({ idempotencyKey: ref.idempotencyKey, providerJobId: ref.providerJobId, projectId }) as unknown as SubmissionRow | undefined;
    if (!row || !row.raw_result_json) return normalizedProviderJobStatusSchema.parse({ status: "failed", error: { code: "provider_unavailable", message: "The fake provider submission could not be found.", retryable: true } });
    return normalizedProviderJobStatusSchema.parse({ status: "succeeded", rawResult: fakeRawResultSchema.parse(parseJson(row.raw_result_json, "Stored fake result is invalid")) });
  }

  normalizeResult(raw: unknown): NormalizedMediaResult {
    const parsed = fakeRawResultSchema.parse(raw);
    return normalizedMediaResultSchema.parse({ providerJobId: parsed.providerJobId, provider: "fake-video", model: "fake-video-model-v1", mediaType: "video", uri: parsed.uri, metadata: { durationSeconds: parsed.durationSeconds, aspectRatio: parsed.aspectRatio, referenceAssetIds: parsed.referenceAssetIds } });
  }
}

export const fakeVideoAdapter = new FakeVideoAdapter();
export function createFakeVideoAdapter() {
  return new FakeVideoAdapter();
}
