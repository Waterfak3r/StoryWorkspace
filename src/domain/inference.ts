import { z } from "zod";
import { factScopeSchema, factValueTypeSchema } from "./story-bible";

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });

export const modelRunStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "stale"]);
export const modelRunKindSchema = z.enum(["fact_extractor"]);

export const modelRunSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  kind: modelRunKindSchema,
  model: z.string().min(1),
  modelVersion: z.string().min(1),
  sourceRevisionId: uuidSchema,
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: modelRunStatusSchema,
  outputHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
});

export const inferenceStatusSchema = z.enum(["active", "dismissed", "promoted", "stale"]);

export const inferenceSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  subjectEntityId: uuidSchema,
  predicate: z.string().min(1),
  value: z.unknown(),
  valueType: factValueTypeSchema,
  scope: factScopeSchema,
  sceneId: uuidSchema.nullable(),
  validFromSceneId: uuidSchema.nullable(),
  validToSceneId: uuidSchema.nullable(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().nullable(),
  modelRunId: uuidSchema,
  evidenceSourceIds: z.array(uuidSchema).optional(),
  status: inferenceStatusSchema,
  version: z.number().int().positive(),
  createdAt: timestampSchema,
});

export const inferenceEvidenceSchema = z.object({
  projectId: uuidSchema,
  inferenceId: uuidSchema,
  evidenceSourceId: uuidSchema,
  createdAt: timestampSchema,
});

export type ModelRunStatus = z.infer<typeof modelRunStatusSchema>;
export type ModelRunKind = z.infer<typeof modelRunKindSchema>;
export type ModelRun = z.infer<typeof modelRunSchema>;
export type InferenceStatus = z.infer<typeof inferenceStatusSchema>;
export type Inference = z.infer<typeof inferenceSchema>;
export type InferenceEvidence = z.infer<typeof inferenceEvidenceSchema>;
