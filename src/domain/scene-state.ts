import { z } from "zod";
import { sceneStatePredicateSchema } from "./story-bible";

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const requestIdSchema = z.string().trim().min(1, "requestId is required").max(200);
const evidenceAnchorSchema = z.object({
  anchorStart: z.number().int().nonnegative(),
  anchorEnd: z.number().int().nonnegative(),
  quotedText: z.string().max(20_000).nullable().optional().default(null),
}).refine((value) => value.anchorEnd >= value.anchorStart, { path: ["anchorEnd"], message: "anchorEnd must be greater than or equal to anchorStart" });

export const continuityGroupKindSchema = z.enum(["main", "flashback", "dream", "parallel", "custom"]);

export const continuityGroupSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  documentId: uuidSchema,
  name: z.string().min(1),
  kind: continuityGroupKindSchema,
  isDefault: z.boolean(),
  version: z.number().int().positive(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type ContinuityGroup = z.infer<typeof continuityGroupSchema>;
export type ContinuityGroupKind = z.infer<typeof continuityGroupKindSchema>;

/** Only non-default continuity lanes are author-created through this API. */
export const createContinuityGroupInputSchema = z.object({
  name: z.string().trim().min(1, "Group name is required").max(200),
  kind: continuityGroupKindSchema.refine((value) => value !== "main", { message: "The default main group is created with the document" }),
  requestId: requestIdSchema,
  actorId: z.string().trim().min(1).max(200).default("local-user"),
}).strict();

export type CreateContinuityGroupInput = z.input<typeof createContinuityGroupInputSchema>;

/** Canonical state payload; unlike Fact payloads it has no scope aliases. */
export const statePatchPayloadSchema = z.object({
  subjectEntityId: uuidSchema,
  predicate: sceneStatePredicateSchema,
  value: z.string(),
  valueType: z.enum(["string", "entity_ref"]),
  appliesAtSceneId: uuidSchema,
  validToSceneId: uuidSchema.nullable(),
  continuityGroupId: uuidSchema,
  carryForward: z.boolean(),
  priority: z.number().int(),
}).strict().superRefine((value, context) => {
  const expected = value.predicate === "state.held_prop" ? "entity_ref" : "string";
  if (value.valueType !== expected) context.addIssue({ code: "custom", path: ["valueType"], message: `Predicate requires valueType ${expected}` });
  if (value.predicate === "state.held_prop" && !uuidSchema.safeParse(value.value).success) context.addIssue({ code: "custom", path: ["value"], message: "held_prop value must be a Prop UUID" });
  if (!value.carryForward && value.validToSceneId !== null) context.addIssue({ code: "custom", path: ["validToSceneId"], message: "validToSceneId requires carryForward" });
});

export type StatePatchPayload = z.infer<typeof statePatchPayloadSchema>;

export const proposeStatePatchInputSchema = z.object({
  documentId: uuidSchema,
  sceneId: uuidSchema,
  sceneRevisionId: uuidSchema,
  subjectEntityId: uuidSchema,
  predicate: sceneStatePredicateSchema,
  value: z.string(),
  valueType: z.enum(["string", "entity_ref"]).optional(),
  carryForward: z.boolean().default(false),
  priority: z.number().int().min(-1_000_000).max(1_000_000).default(100),
  validToSceneId: uuidSchema.nullable().default(null),
  baseVersion: z.number().int().positive(),
  evidence: z.array(evidenceAnchorSchema).min(1),
  requestId: requestIdSchema,
  actorId: z.string().trim().min(1).max(200).default("local-user"),
}).strict().superRefine((value, context) => {
  const expected = value.predicate === "state.held_prop" ? "entity_ref" : "string";
  if (value.valueType !== undefined && value.valueType !== expected) context.addIssue({ code: "custom", path: ["valueType"], message: `Predicate requires valueType ${expected}` });
  if (expected === "entity_ref" && !uuidSchema.safeParse(value.value).success) context.addIssue({ code: "custom", path: ["value"], message: "held_prop value must be a Prop UUID" });
  if (!value.carryForward && value.validToSceneId !== null) context.addIssue({ code: "custom", path: ["validToSceneId"], message: "validToSceneId requires carryForward" });
});

export type ProposeStatePatchInput = z.input<typeof proposeStatePatchInputSchema>;
export type ParsedProposeStatePatchInput = z.output<typeof proposeStatePatchInputSchema>;

export const resolveSceneStateQuerySchema = z.object({
  sceneRevisionId: uuidSchema,
  entityId: uuidSchema.optional(),
}).strict();

export type ResolveSceneStateQuery = z.infer<typeof resolveSceneStateQuerySchema>;

export const resolvedStateSourceSchema = z.object({
  kind: z.enum(["state", "fact"]),
  recordId: uuidSchema,
  evidenceSourceId: uuidSchema,
  value: z.unknown(),
  tier: z.enum(["explicit", "carried", "base"]),
  priority: z.number().int(),
  appliesAtSceneId: uuidSchema.nullable(),
  sourceRevisionId: uuidSchema.nullable(),
  quotedText: z.string().nullable(),
}).strict();

export const resolvedStateFieldSchema = z.object({
  predicate: sceneStatePredicateSchema,
  tier: z.enum(["explicit", "carried", "base", "missing", "conflict"]),
  value: z.unknown().nullable(),
  valueType: z.enum(["string", "entity_ref"]),
  cardinality: z.enum(["single", "multi"]),
  priority: z.number().int().nullable(),
  blockingConflict: z.boolean(),
  conflictValues: z.array(z.unknown()),
  sources: z.array(resolvedStateSourceSchema),
}).strict();

export const resolvedStateEntitySchema = z.object({
  entityId: uuidSchema,
  fields: z.array(resolvedStateFieldSchema),
  hasBlockingConflicts: z.boolean(),
}).strict();

export const resolvedStateResponseSchema = z.object({
  sceneId: uuidSchema,
  sceneRevisionId: uuidSchema,
  continuityGroupId: uuidSchema,
  entities: z.array(resolvedStateEntitySchema),
  hasBlockingConflicts: z.boolean(),
}).strict();

export type ResolvedStateField = z.infer<typeof resolvedStateFieldSchema>;
export type ResolvedStateEntity = z.infer<typeof resolvedStateEntitySchema>;
export type ResolvedStateResponse = z.infer<typeof resolvedStateResponseSchema>;
