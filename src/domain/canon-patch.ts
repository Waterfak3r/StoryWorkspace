import { z } from "zod";
import { factScopeSchema, factValueTypeSchema } from "./story-bible";
import { statePatchPayloadSchema, type StatePatchPayload as SceneStatePatchPayload } from "./scene-state";

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });

export const patchOperationSchema = z.enum(["add_fact", "replace_fact", "retract_fact", "add_state"]);
/* A Phase 2 Patch is a review command for a Canon mutation. Inferred model
 * output is represented by Inference and is intentionally a different DTO. */
export const patchTruthClassSchema = z.literal("canon");
export const analysisPatchTruthClassSchema = z.enum(["canon", "inferred"]);
export const patchStatusSchema = z.enum(["pending", "accepted", "rejected", "expired", "superseded"]);
export const patchConflictKindSchema = z.enum(["none", "possible", "hard"]);
export const patchProposedBySchema = z.enum(["rule", "model", "user", "import"]);

/** The only payload shape that can be promoted to a Canon Fact. */
export const factPatchPayloadSchema = z.object({
  subjectEntityId: uuidSchema,
  predicate: z.string().trim().min(1).max(200),
  value: z.unknown(),
  valueType: factValueTypeSchema,
  scope: factScopeSchema,
  sceneId: uuidSchema.nullable().default(null),
  validFromSceneId: uuidSchema.nullable().default(null),
  validToSceneId: uuidSchema.nullable().default(null),
}).strict();

export { statePatchPayloadSchema } from "./scene-state";

export const retractFactPatchPayloadSchema = z.object({}).strict();

const patchShape = {
  id: uuidSchema,
  projectId: uuidSchema,
  operation: patchOperationSchema,
  targetEntityId: uuidSchema.nullable(),
  targetFactId: uuidSchema.nullable(),
  baseVersion: z.number().int().positive().nullable(),
  payload: z.record(z.string(), z.unknown()),
  truthClass: patchTruthClassSchema,
  evidenceSourceIds: z.array(uuidSchema),
  confidence: z.number().min(0).max(1).nullable(),
  conflictKind: patchConflictKindSchema,
  conflictingFactIds: z.array(uuidSchema),
  conflictingStateIds: z.array(uuidSchema).default([]),
  conflictMessage: z.string().nullable(),
  sourceRevisionId: uuidSchema,
  inferenceId: uuidSchema.nullable(),
  modelRunId: uuidSchema.nullable(),
  status: patchStatusSchema,
  proposedBy: patchProposedBySchema,
  version: z.number().int().positive(),
  createdAt: timestampSchema,
  resolvedAt: timestampSchema.nullable(),
  resolvedByUserId: z.string().nullable(),
} as const;

function enforcePendingPatchShape(patch: z.infer<z.ZodObject<typeof patchShape>>, context: z.RefinementCtx) {
  if (patch.operation === "add_fact" && (!patch.targetEntityId || patch.targetFactId !== null || patch.baseVersion === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["operation"], message: "add_fact requires targetEntityId/baseVersion and no targetFactId" });
  }
  if ((patch.operation === "replace_fact" || patch.operation === "retract_fact") && (patch.targetFactId === null || patch.baseVersion === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["operation"], message: `${patch.operation} requires targetFactId/baseVersion` });
  }
  if (patch.operation === "replace_fact" && patch.targetEntityId === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["targetEntityId"], message: "replace_fact requires targetEntityId" });
  }
  if (patch.operation === "add_state" && (!patch.targetEntityId || patch.targetFactId !== null || patch.baseVersion === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["operation"], message: "add_state requires targetEntityId/baseVersion and no targetFactId" });
  }
  if (patch.operation === "add_state") {
    const parsed = statePatchPayloadSchema.safeParse(patch.payload);
    if (!parsed.success) context.addIssue({ code: z.ZodIssueCode.custom, path: ["payload"], message: "add_state payload is invalid" });
  }
}

export const patchSchema = z.object(patchShape).superRefine(enforcePendingPatchShape);

/* Legacy analysis payloads may include inferred candidates. This schema is
 * deliberately not used by Phase 2 APIs or persistence. */
export const analysisPatchSchema = z.object({ ...patchShape, truthClass: analysisPatchTruthClassSchema });

export const pendingPatchSchema = patchSchema;

export const patchEvidenceSchema = z.object({
  projectId: uuidSchema,
  patchId: uuidSchema,
  evidenceSourceId: uuidSchema,
  createdAt: timestampSchema,
});

export const patchApplicationSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  patchId: uuidSchema,
  operation: patchOperationSchema,
  resultingFactId: uuidSchema.nullable().default(null),
  resultingStateId: uuidSchema.nullable(),
  appliedPayload: z.record(z.string(), z.unknown()),
  requestId: z.string().min(1),
  createdAt: timestampSchema,
}).superRefine((application, context) => {
  const factResult = application.operation === "add_fact" || application.operation === "replace_fact" || application.operation === "retract_fact";
  if (factResult && (application.resultingFactId === null || application.resultingStateId !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["operation"], message: `${application.operation} requires one Fact result and no State result` });
  }
  if (application.operation === "add_state" && (application.resultingFactId !== null || application.resultingStateId === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["operation"], message: "add_state requires one State result and no Fact result" });
  }
});

export const evidenceAnchorSchema = z.object({
  anchorStart: z.number().int().nonnegative(),
  anchorEnd: z.number().int().nonnegative(),
  quotedText: z.string().max(20_000).nullable().optional().default(null),
}).refine((value) => value.anchorEnd >= value.anchorStart, { path: ["anchorEnd"], message: "anchorEnd must be greater than or equal to anchorStart" });

const requestIdSchema = z.string().trim().min(1).max(200);

export const proposeFactPatchInputSchema = z.object({
  documentId: uuidSchema,
  sceneId: uuidSchema,
  sceneRevisionId: uuidSchema,
  operation: patchOperationSchema,
  subjectEntityId: uuidSchema.optional(),
  predicate: z.string().trim().min(1).max(200).optional(),
  value: z.unknown().optional(),
  valueType: factValueTypeSchema.optional(),
  scope: factScopeSchema.optional(),
  factSceneId: uuidSchema.nullable().optional(),
  validFromSceneId: uuidSchema.nullable().optional(),
  validToSceneId: uuidSchema.nullable().optional(),
  targetEntityId: uuidSchema.optional(),
  targetFactId: uuidSchema.optional(),
  baseVersion: z.number().int().positive().optional(),
  evidence: z.array(evidenceAnchorSchema).min(1),
  confidence: z.number().min(0).max(1).optional().default(0.5),
  rationale: z.string().max(2_000).nullable().optional().default(null),
  model: z.string().trim().min(1).max(100).optional().default("deterministic-fixture"),
  modelVersion: z.string().trim().min(1).max(100).optional().default("fact-fixture-v1"),
  proposedBy: patchProposedBySchema.optional().default("rule"),
  requestId: requestIdSchema,
  actorId: z.string().trim().min(1).max(200).optional().default("local-user"),
}).strict();

/** Explicit user command for a temporary Scene State. It intentionally has no
 * model/modelVersion fields and never creates ModelRun or Inference rows. */
export { proposeStatePatchInputSchema } from "./scene-state";

export const acceptPatchInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  requestId: requestIdSchema,
  actorId: z.string().trim().min(1).max(200).optional().default("local-user"),
}).strict();

export const acceptEditedPatchInputSchema = acceptPatchInputSchema.extend({
  payload: z.record(z.string(), z.unknown()),
}).strict();

export const rejectPatchInputSchema = acceptPatchInputSchema.extend({
  reason: z.string().trim().max(2_000).nullable().optional().default(null),
}).strict();

export type PatchOperation = z.infer<typeof patchOperationSchema>;
export type PatchTruthClass = z.infer<typeof patchTruthClassSchema>;
export type AnalysisPatch = z.infer<typeof analysisPatchSchema>;
export type PendingPatch = z.infer<typeof pendingPatchSchema>;
export type PatchStatus = z.infer<typeof patchStatusSchema>;
export type PatchConflictKind = z.infer<typeof patchConflictKindSchema>;
export type PatchProposedBy = z.infer<typeof patchProposedBySchema>;
export type FactPatchPayload = z.infer<typeof factPatchPayloadSchema>;
export type StatePatchPayload = SceneStatePatchPayload;
export type Patch = z.infer<typeof patchSchema>;
export type PatchEvidence = z.infer<typeof patchEvidenceSchema>;
export type PatchApplication = z.infer<typeof patchApplicationSchema>;
export type EvidenceAnchor = z.infer<typeof evidenceAnchorSchema>;
export type ProposeFactPatchInput = z.input<typeof proposeFactPatchInputSchema>;
export type ProposeStatePatchInput = import("./scene-state").ProposeStatePatchInput;
export type AcceptPatchInput = z.input<typeof acceptPatchInputSchema>;
export type AcceptEditedPatchInput = z.input<typeof acceptEditedPatchInputSchema>;
export type RejectPatchInput = z.input<typeof rejectPatchInputSchema>;
