import { z } from "zod";

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });

/** Phase 1 deliberately keeps the resolver surface small and deterministic. */
export const analysisEntityTypeSchema = z.enum(["character", "location", "prop"]);
export const analysisRunStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "stale"]);
export const entityMentionStatusSchema = z.enum(["active", "stale", "rejected"]);

export const analysisRunSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  documentId: uuidSchema,
  sceneId: uuidSchema,
  sceneRevisionId: uuidSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  analyzerVersion: z.string().min(1),
  idempotencyKey: z.string().min(1),
  status: analysisRunStatusSchema,
  leaseToken: z.string().nullable(),
  leaseExpiresAt: timestampSchema.nullable(),
  attempt: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: timestampSchema.nullable(),
  completedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

/**
 * Offsets are only meaningful together with sceneRevisionId. They are kept as
 * integers for the deterministic local analyzer and are never used as global
 * document positions.
 */
export const entityMentionSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  documentId: uuidSchema,
  sceneId: uuidSchema,
  sceneRevisionId: uuidSchema,
  analysisRunId: uuidSchema,
  entityId: uuidSchema.nullable(),
  entityType: analysisEntityTypeSchema,
  surface: z.string().min(1),
  normalizedSurface: z.string().min(1),
  anchorStart: z.number().int().nonnegative(),
  anchorEnd: z.number().int().nonnegative(),
  candidateGroupId: uuidSchema,
  fingerprint: z.string().min(1),
  evidenceSourceId: uuidSchema,
  status: entityMentionStatusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).refine((value) => value.anchorEnd >= value.anchorStart, {
  path: ["anchorEnd"],
  message: "anchorEnd must be greater than or equal to anchorStart",
});

export const enqueueAnalysisInputSchema = z.object({
  documentId: uuidSchema,
  sceneId: uuidSchema,
  sceneRevisionId: uuidSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  analyzerVersion: z.string().trim().min(1).max(100).optional().default("deterministic-v1"),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  requestId: z.string().trim().min(1).max(200).optional(),
  actorId: z.string().trim().min(1).max(200).optional().default("local-user"),
}).strict().superRefine((value, context) => {
  if (value.idempotencyKey !== undefined && value.requestId !== undefined && value.idempotencyKey !== value.requestId) {
    context.addIssue({ code: "custom", path: ["requestId"], message: "idempotencyKey and requestId must match" });
  }
});

export const executeAnalysisInputSchema = z.object({
  leaseToken: z.string().trim().min(1).max(200).optional(),
  leaseSeconds: z.number().int().min(1).max(300).optional().default(30),
  requestId: z.string().trim().min(1).max(200).optional(),
}).strict();

export type AnalysisEntityType = z.infer<typeof analysisEntityTypeSchema>;
export type AnalysisRunStatus = z.infer<typeof analysisRunStatusSchema>;
export type AnalysisRun = z.infer<typeof analysisRunSchema>;
export type EntityMentionStatus = z.infer<typeof entityMentionStatusSchema>;
export type EntityMention = z.infer<typeof entityMentionSchema>;
export type EnqueueAnalysisInput = z.input<typeof enqueueAnalysisInputSchema>;
export type ExecuteAnalysisInput = z.input<typeof executeAnalysisInputSchema>;

/** The analyzer version is part of idempotency and projection provenance. */
export const DETERMINISTIC_ANALYZER_VERSION = "deterministic-v1";

/** Shared normalization for Chinese, English, and full-width text. */
export function normalizeAnalysisText(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/gu, " ");
}
/** Backwards-friendly name for callers that treat the resolver as alias based. */
export const normalizeEntitySurface = normalizeAnalysisText;

export function mentionFingerprint(input: {
  sceneRevisionId: string;
  entityType: AnalysisEntityType;
  normalizedSurface: string;
  anchorStart: number;
  anchorEnd: number;
}) {
  return [input.sceneRevisionId, input.entityType, input.normalizedSurface, input.anchorStart, input.anchorEnd].join(":");
}
