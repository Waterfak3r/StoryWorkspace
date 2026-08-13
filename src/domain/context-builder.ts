import { z } from "zod";
import { resolvedStateEntitySchema } from "./scene-state";
import { factValueTypeSchema } from "./story-bible";
import { sceneEntityLinkRoleSchema } from "./scene-link";

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const requestIdSchema = z.string().trim().min(1, "requestId is required").max(200);

export const contextPurposeSchema = z.enum(["storyboard", "video"]);
export const contextPolicyIdSchema = z.enum(["storyboard-default-v1", "video-default-v1"]);
export const contextPolicyVersionSchema = z.literal("1");

export type ContextPurpose = z.infer<typeof contextPurposeSchema>;
export type ContextPolicyId = z.infer<typeof contextPolicyIdSchema>;

export const contextBudgetsSchema = z.object({
  sceneChars: z.number().int().positive(),
  maxEntities: z.number().int().positive(),
  maxBaseFactsPerEntity: z.number().int().positive(),
}).strict();

export const contextPolicySchema = z.object({
  id: contextPolicyIdSchema,
  version: contextPolicyVersionSchema,
  budgets: contextBudgetsSchema,
}).strict();

export const CONTEXT_POLICIES: Readonly<Record<ContextPolicyId, z.infer<typeof contextPolicySchema>>> = {
  "storyboard-default-v1": { id: "storyboard-default-v1", version: "1", budgets: { sceneChars: 40_000, maxEntities: 20, maxBaseFactsPerEntity: 12 } },
  "video-default-v1": { id: "video-default-v1", version: "1", budgets: { sceneChars: 40_000, maxEntities: 20, maxBaseFactsPerEntity: 12 } },
};

export function contextPolicyFor(id: ContextPolicyId) {
  return CONTEXT_POLICIES[id];
}

export const buildContextInputSchema = z.object({
  sceneId: uuidSchema,
  sceneRevisionId: uuidSchema,
  purpose: contextPurposeSchema,
  policyId: contextPolicyIdSchema,
  allowInferred: z.literal(false).optional().default(false),
  requestId: requestIdSchema,
  actorId: z.string().trim().min(1).max(200).optional().default("local-user"),
}).strict().superRefine((value, context) => {
  const expected = value.purpose === "storyboard" ? "storyboard-default-v1" : "video-default-v1";
  if (value.policyId !== expected) context.addIssue({ code: "custom", path: ["policyId"], message: "policyId must match purpose" });
});

export type BuildContextInput = z.input<typeof buildContextInputSchema>;
export type ParsedBuildContextInput = z.output<typeof buildContextInputSchema>;

export const contextMissingSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["blocking", "warning"]),
  message: z.string().min(1),
  entityId: uuidSchema.optional(),
  entityType: z.string().optional(),
  sourceIds: z.array(uuidSchema).optional(),
}).strict();

export const contextConflictSchema = z.object({
  code: z.string().min(1),
  severity: z.literal("blocking"),
  message: z.string().min(1),
  entityId: uuidSchema.optional(),
  predicate: z.string().optional(),
  sourceIds: z.array(uuidSchema),
  values: z.array(z.unknown()),
}).strict();

export const contextWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  entityId: uuidSchema.optional(),
}).strict();

export const contextOmittedSchema = z.object({
  kind: z.enum(["scene", "entity", "link", "fact", "state"]),
  recordId: uuidSchema.optional(),
  reason: z.enum(["policy_excluded", "not_confirmed", "budget"]),
  entityId: uuidSchema.optional(),
  predicate: z.string().optional(),
}).strict();

export const contextProvenanceSchema = z.object({
  kind: z.enum(["scene_revision", "scene_entity_link", "entity", "fact", "state", "evidence_source"]),
  recordId: uuidSchema,
  version: z.number().int().positive().optional(),
  sourceId: uuidSchema.optional(),
}).strict();

export const contextBaseFactSchema = z.object({
  factId: uuidSchema,
  predicate: z.string().min(1),
  value: z.unknown(),
  valueType: factValueTypeSchema,
  version: z.number().int().positive(),
  sourceId: uuidSchema,
}).strict();

export const contextResolvedStateSchema = resolvedStateEntitySchema;

export const contextEntitySchema = z.object({
  entityId: uuidSchema,
  type: z.enum(["character", "location", "prop", "organization", "event"]),
  canonicalName: z.string().min(1),
  entityVersion: z.number().int().positive(),
  roles: z.array(sceneEntityLinkRoleSchema),
  linkIds: z.array(uuidSchema),
  baseFacts: z.array(contextBaseFactSchema),
  resolvedState: contextResolvedStateSchema.nullable(),
}).strict();

export const contextContentSchema = z.object({
  scene: z.object({
    id: uuidSchema,
    revisionId: uuidSchema,
    title: z.string(),
    text: z.string(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  purpose: contextPurposeSchema,
  policy: contextPolicySchema,
  entities: z.array(contextEntitySchema),
  organizations: z.array(z.never()),
  events: z.array(z.never()),
  history: z.array(z.never()),
  globalStyle: z.object({}).strict(),
  missing: z.array(contextMissingSchema),
  conflicts: z.array(contextConflictSchema),
  warnings: z.array(contextWarningSchema),
  omitted: z.array(contextOmittedSchema),
  provenance: z.array(contextProvenanceSchema),
  hasBlockingIssues: z.boolean(),
}).strict();

export type ContextContent = z.infer<typeof contextContentSchema>;
export type ContextEntity = z.infer<typeof contextEntitySchema>;

export const contextSnapshotSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  sceneId: uuidSchema,
  sceneRevisionId: uuidSchema,
  purpose: contextPurposeSchema,
  policyId: contextPolicyIdSchema,
  policyVersion: contextPolicyVersionSchema,
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  content: contextContentSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  isLatest: z.boolean(),
  createdAt: timestampSchema,
}).strict();

export type ContextSnapshot = z.infer<typeof contextSnapshotSchema>;

export function canonicalizeContextValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeContextValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalizeContextValue((value as Record<string, unknown>)[key])]));
  }
  return value;
}

export function canonicalContextJson(value: unknown) {
  return JSON.stringify(canonicalizeContextValue(value));
}
