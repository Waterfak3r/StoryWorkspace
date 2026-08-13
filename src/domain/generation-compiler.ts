import { z } from "zod";

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const requestIdSchema = z.string().trim().min(1, "requestId is required").max(200);

export const FAKE_VIDEO_CAPABILITY_PROFILE_ID = "fake-video-v1" as const;
export const FAKE_VIDEO_CAPABILITY_PROFILE_VERSION = "1" as const;
export const FAKE_VIDEO_COMPILER_VERSION = "fake-video-compiler-v1" as const;

export const providerCapabilityProfileSchema = z.object({
  id: z.literal(FAKE_VIDEO_CAPABILITY_PROFILE_ID),
  provider: z.literal("fake-video"),
  model: z.literal("fake-video-model-v1"),
  version: z.literal(FAKE_VIDEO_CAPABILITY_PROFILE_VERSION),
  modalities: z.tuple([z.literal("text"), z.literal("image"), z.literal("video")]),
  supports: z.object({
    textPrompt: z.literal(true),
    negativePrompt: z.literal(true),
    referenceImages: z.literal(true),
    maxReferenceImages: z.literal(2),
    firstFrame: z.literal(false),
    lastFrame: z.literal(false),
    characterId: z.literal(false),
    styleReference: z.literal(false),
    audioInput: z.literal(false),
    dialogue: z.literal(false),
    seed: z.literal(false),
  }).strict(),
  limits: z.object({
    promptChars: z.literal(4_000),
    durationSeconds: z.tuple([z.literal(4), z.literal(6), z.literal(8)]),
    aspectRatios: z.tuple([z.literal("16:9"), z.literal("9:16")]),
  }).strict(),
}).strict();

export type ProviderCapabilityProfile = z.infer<typeof providerCapabilityProfileSchema>;

export const FAKE_VIDEO_CAPABILITY_PROFILE: ProviderCapabilityProfile = {
  id: FAKE_VIDEO_CAPABILITY_PROFILE_ID,
  provider: "fake-video",
  model: "fake-video-model-v1",
  version: FAKE_VIDEO_CAPABILITY_PROFILE_VERSION,
  modalities: ["text", "image", "video"],
  supports: {
    textPrompt: true,
    negativePrompt: true,
    referenceImages: true,
    maxReferenceImages: 2,
    firstFrame: false,
    lastFrame: false,
    characterId: false,
    styleReference: false,
    audioInput: false,
    dialogue: false,
    seed: false,
  },
  limits: { promptChars: 4_000, durationSeconds: [4, 6, 8], aspectRatios: ["16:9", "9:16"] },
};

export const referenceAssetSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  entityId: uuidSchema,
  kind: z.literal("reference_image"),
  label: z.string().trim().min(1).max(300),
  status: z.literal("approved"),
  version: z.literal(1),
  metadataHash: hashSchema,
  createdBy: z.string().min(1).max(200),
  createdAt: timestampSchema,
}).strict();

export type ReferenceAsset = z.infer<typeof referenceAssetSchema>;

export const createReferenceAssetInputSchema = z.object({
  entityId: uuidSchema,
  label: z.string().trim().min(1).max(300),
  requestId: requestIdSchema,
  actorId: z.string().trim().min(1).max(200).optional().default("local-user"),
}).strict();

export type CreateReferenceAssetInput = z.input<typeof createReferenceAssetInputSchema>;

export const compileParametersInputSchema = z.object({
  durationSeconds: z.number().positive().max(60).nullable().optional(),
  aspectRatio: z.string().trim().min(1).max(20).nullable().optional(),
}).strict();

export const compileShotInputSchema = z.object({
  capabilityProfileId: z.literal(FAKE_VIDEO_CAPABILITY_PROFILE_ID).optional().default(FAKE_VIDEO_CAPABILITY_PROFILE_ID),
  referenceAssetIds: z.array(uuidSchema).max(20).optional().default([]),
  parameters: compileParametersInputSchema.optional().default({}),
  requestId: requestIdSchema,
  actorId: z.string().trim().min(1).max(200).optional().default("local-user"),
}).strict().superRefine((value, context) => {
  if (new Set(value.referenceAssetIds).size !== value.referenceAssetIds.length) {
    context.addIssue({ code: "custom", path: ["referenceAssetIds"], message: "referenceAssetIds must be unique" });
  }
});

export type CompileShotInput = z.input<typeof compileShotInputSchema>;

export const compiledPromptSegmentSchema = z.object({
  role: z.enum(["scene", "character", "state", "camera", "style", "constraint"]),
  text: z.string().min(1).max(4_000),
  sourceIds: z.array(uuidSchema).min(1),
}).strict().superRefine((value, context) => {
  if (new Set(value.sourceIds).size !== value.sourceIds.length) {
    context.addIssue({ code: "custom", path: ["sourceIds"], message: "sourceIds must be unique" });
  }
});

export const compiledAssetInputSchema = z.object({
  assetId: uuidSchema,
  entityId: uuidSchema,
  purpose: z.enum(["character", "location", "prop"]),
  weight: z.number().min(0).max(1),
}).strict();

export const compiledGenerationRequestSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  sceneId: uuidSchema,
  shotSpecId: uuidSchema,
  contextSnapshotId: uuidSchema,
  provider: z.literal("fake-video"),
  model: z.literal("fake-video-model-v1"),
  capabilityProfileId: z.literal(FAKE_VIDEO_CAPABILITY_PROFILE_ID),
  capabilityProfileVersion: z.literal(FAKE_VIDEO_CAPABILITY_PROFILE_VERSION),
  compilerVersion: z.literal(FAKE_VIDEO_COMPILER_VERSION),
  promptSegments: z.array(compiledPromptSegmentSchema).min(1),
  negativePrompt: z.string().min(1).max(4_000).nullable(),
  assetInputs: z.array(compiledAssetInputSchema).max(2),
  providerBindings: z.tuple([]),
  parameters: z.object({
    durationSeconds: z.union([z.literal(4), z.literal(6), z.literal(8)]),
    aspectRatio: z.enum(["16:9", "9:16"]),
  }).strict(),
  warnings: z.array(z.string().min(1)),
  omittedContext: z.array(z.string().min(1)),
  inputHash: hashSchema,
  compiledHash: hashSchema,
  createdAt: timestampSchema,
}).strict();

export type CompiledGenerationRequest = z.infer<typeof compiledGenerationRequestSchema>;

export const fakePreparedRequestSchema = z.object({
  provider: z.literal("fake-video"),
  model: z.literal("fake-video-model-v1"),
  endpoint: z.literal("fake://video/generate"),
  body: z.object({
    prompt: z.string().min(1).max(4_000),
    negativePrompt: z.string().min(1).max(4_000).nullable(),
    referenceAssetIds: z.array(uuidSchema).max(2),
    durationSeconds: z.union([z.literal(4), z.literal(6), z.literal(8)]),
    aspectRatio: z.enum(["16:9", "9:16"]),
  }).strict(),
  requestHash: hashSchema,
}).strict();

export type FakePreparedRequest = z.infer<typeof fakePreparedRequestSchema>;

export const compileShotResultSchema = z.object({
  compiledRequest: compiledGenerationRequestSchema,
  preview: fakePreparedRequestSchema,
  idempotent: z.boolean(),
}).strict();

export type CompileShotResult = z.infer<typeof compileShotResultSchema>;
