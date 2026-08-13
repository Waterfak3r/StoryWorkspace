import { z } from "zod";

import {
  FAKE_VIDEO_CAPABILITY_PROFILE_ID,
  FAKE_VIDEO_CAPABILITY_PROFILE_VERSION,
  FAKE_VIDEO_COMPILER_VERSION,
  fakePreparedRequestSchema,
} from "./generation-compiler";

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const requestIdSchema = z.string().trim().min(1, "requestId is required").max(200);

export const fakeGenerationBehaviorSchema = z.enum([
  "success",
  "timeout_after_accept_once",
  "invalid_input",
]);

export type FakeGenerationBehavior = z.infer<typeof fakeGenerationBehaviorSchema>;

export const normalizedProviderErrorCodeSchema = z.enum([
  "invalid_input",
  "auth",
  "quota",
  "rate_limit",
  "safety",
  "provider_unavailable",
  "timeout",
  "unknown",
]);

export type NormalizedProviderErrorCode = z.infer<typeof normalizedProviderErrorCodeSchema>;

export const normalizedProviderErrorSchema = z.object({
  code: normalizedProviderErrorCodeSchema,
  message: z.string().trim().min(1).max(1_000),
  retryable: z.boolean(),
}).strict();

export type NormalizedProviderError = z.infer<typeof normalizedProviderErrorSchema>;

export const submitGenerationInputSchema = z.object({
  compiledRequestId: uuidSchema,
  requestId: requestIdSchema,
  actorId: z.string().trim().min(1).max(200).optional().default("local-user"),
  fakeBehavior: fakeGenerationBehaviorSchema.optional().default("success"),
}).strict();

export type SubmitGenerationInput = z.input<typeof submitGenerationInputSchema>;
export type ParsedSubmitGenerationInput = z.output<typeof submitGenerationInputSchema>;

export const retryGenerationJobInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  requestId: requestIdSchema,
  actorId: z.string().trim().min(1).max(200).optional().default("local-user"),
}).strict();

export type RetryGenerationJobInput = z.input<typeof retryGenerationJobInputSchema>;
export type ParsedRetryGenerationJobInput = z.output<typeof retryGenerationJobInputSchema>;

export const generationManifestParametersSchema = z.object({
  durationSeconds: z.union([z.literal(4), z.literal(6), z.literal(8)]),
  aspectRatio: z.enum(["16:9", "9:16"]),
  referenceAssetIds: z.array(uuidSchema).max(2),
  fakeBehavior: fakeGenerationBehaviorSchema,
}).strict();

export const generationManifestSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  sceneId: uuidSchema,
  storyboardId: uuidSchema,
  shotSpecId: uuidSchema,
  contextSnapshotId: uuidSchema,
  compiledRequestId: uuidSchema,
  provider: z.literal("fake-video"),
  model: z.literal("fake-video-model-v1"),
  capabilityProfileId: z.literal(FAKE_VIDEO_CAPABILITY_PROFILE_ID),
  capabilityProfileVersion: z.literal(FAKE_VIDEO_CAPABILITY_PROFILE_VERSION),
  compilerVersion: z.literal(FAKE_VIDEO_COMPILER_VERSION),
  preparedRequest: fakePreparedRequestSchema,
  parameters: generationManifestParametersSchema,
  compiledHash: hashSchema,
  manifestHash: hashSchema,
  createdBy: z.string().trim().min(1).max(200),
  createdAt: timestampSchema,
}).strict();

export type GenerationManifest = z.infer<typeof generationManifestSchema>;

export const generationJobStatusSchema = z.enum(["queued", "running", "succeeded", "failed"]);

export const generationJobSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  manifestId: uuidSchema,
  status: generationJobStatusSchema,
  version: z.number().int().positive(),
  attemptCount: z.number().int().nonnegative(),
  providerJobId: z.string().trim().min(1).max(300).nullable(),
  error: normalizedProviderErrorSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict();

export type GenerationJob = z.infer<typeof generationJobSchema>;

export const generationResultMetadataSchema = z.object({
  durationSeconds: z.union([z.literal(4), z.literal(6), z.literal(8)]),
  aspectRatio: z.enum(["16:9", "9:16"]),
  referenceAssetIds: z.array(uuidSchema).max(2),
}).strict();

export const generationResultSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  manifestId: uuidSchema,
  jobId: uuidSchema,
  providerJobId: z.string().trim().min(1).max(300),
  provider: z.literal("fake-video"),
  model: z.literal("fake-video-model-v1"),
  mediaType: z.literal("video"),
  uri: z.string().startsWith("fake://video/results/"),
  metadata: generationResultMetadataSchema,
  resultHash: hashSchema,
  createdAt: timestampSchema,
}).strict();

export type GenerationResult = z.infer<typeof generationResultSchema>;

export const generationRecordSchema = z.object({
  manifest: generationManifestSchema,
  job: generationJobSchema,
  result: generationResultSchema.nullable(),
}).strict();

export type GenerationRecord = z.infer<typeof generationRecordSchema>;

export const generationCommandResultSchema = generationRecordSchema.extend({
  idempotent: z.boolean(),
}).strict();

export type GenerationCommandResult = z.infer<typeof generationCommandResultSchema>;

export const fakeProviderJobRefSchema = z.object({
  provider: z.literal("fake-video"),
  providerJobId: z.string().trim().min(1).max(300),
  idempotencyKey: z.string().trim().min(1).max(300),
}).strict();

export type FakeProviderJobRef = z.infer<typeof fakeProviderJobRefSchema>;

export const fakeRawResultSchema = z.object({
  providerJobId: z.string().trim().min(1).max(300),
  uri: z.string().startsWith("fake://video/results/"),
  durationSeconds: z.union([z.literal(4), z.literal(6), z.literal(8)]),
  aspectRatio: z.enum(["16:9", "9:16"]),
  referenceAssetIds: z.array(uuidSchema).max(2),
}).strict();

export type FakeRawResult = z.infer<typeof fakeRawResultSchema>;

export const normalizedProviderJobStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("queued") }).strict(),
  z.object({ status: z.literal("running") }).strict(),
  z.object({ status: z.literal("succeeded"), rawResult: fakeRawResultSchema }).strict(),
  z.object({ status: z.literal("failed"), error: normalizedProviderErrorSchema }).strict(),
]);

export type NormalizedProviderJobStatus = z.infer<typeof normalizedProviderJobStatusSchema>;

export const normalizedMediaResultSchema = z.object({
  providerJobId: z.string().trim().min(1).max(300),
  provider: z.literal("fake-video"),
  model: z.literal("fake-video-model-v1"),
  mediaType: z.literal("video"),
  uri: z.string().startsWith("fake://video/results/"),
  metadata: generationResultMetadataSchema,
}).strict();

export type NormalizedMediaResult = z.infer<typeof normalizedMediaResultSchema>;
