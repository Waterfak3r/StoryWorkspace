import { z } from "zod";

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });

export const entityTypeSchema = z.enum(["character", "location", "prop", "organization", "event"]);
export const entityStatusSchema = z.enum(["draft", "active", "archived", "merged"]);
export const aliasStatusSchema = z.enum(["active", "archived"]);
export const factValueTypeSchema = z.enum(["string", "number", "boolean", "enum", "entity_ref", "json"]);
export const factScopeSchema = z.enum(["base", "scene", "range"]);
export const factStatusSchema = z.enum(["active", "superseded", "retracted"]);
export const evidenceSourceKindSchema = z.enum(["text_span", "user_input", "import", "asset", "model_output"]);

const attributesSchema = z.record(z.string(), z.unknown());

export const entitySchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  type: entityTypeSchema,
  canonicalName: z.string().min(1),
  status: entityStatusSchema,
  mergedIntoEntityId: uuidSchema.nullable(),
  attributes: attributesSchema,
  schemaVersion: z.number().int().positive(),
  version: z.number().int().positive(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const entityAliasSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  entityId: uuidSchema,
  alias: z.string().min(1),
  normalizedAlias: z.string().min(1),
  locale: z.string().min(1).nullable(),
  status: aliasStatusSchema,
  createdAt: timestampSchema,
});

export const aliasSchema = entityAliasSchema;

export const evidenceSourceSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  kind: evidenceSourceKindSchema,
  documentId: uuidSchema.nullable(),
  sceneId: uuidSchema.nullable(),
  /** A scene revision, never a document revision. */
  revisionId: uuidSchema.nullable(),
  sceneRevisionId: uuidSchema.nullable(),
  anchorStart: z.string().nullable(),
  anchorEnd: z.string().nullable(),
  quotedText: z.string().nullable(),
  createdByUserId: z.string().nullable(),
  modelRunId: z.string().nullable(),
  createdAt: timestampSchema,
});

export const factSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  subjectEntityId: uuidSchema,
  predicate: z.string().min(1),
  value: z.unknown(),
  valueType: factValueTypeSchema,
  truthClass: z.literal("canon"),
  scope: factScopeSchema,
  sceneId: uuidSchema.nullable(),
  validFromSceneId: uuidSchema.nullable(),
  validToSceneId: uuidSchema.nullable(),
  sourceId: uuidSchema,
  /** Non-null only when an Inference was promoted through a reviewed Patch. */
  promotedFromInferenceId: uuidSchema.nullable().optional().default(null),
  status: factStatusSchema,
  supersedesFactId: uuidSchema.nullable(),
  version: z.number().int().positive(),
  createdAt: timestampSchema,
});

export const auditEventSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  eventType: z.string().min(1),
  aggregateType: z.string().min(1),
  aggregateId: uuidSchema,
  aggregateVersion: z.number().int().nonnegative().nullable(),
  payload: attributesSchema,
  actorId: z.string().min(1),
  requestId: z.string().min(1),
  createdAt: timestampSchema,
});

export const outboxEventStatusSchema = z.enum(["pending", "published", "failed"]);
export const outboxEventSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  eventType: z.string().min(1),
  aggregateType: z.string().min(1),
  aggregateId: uuidSchema,
  aggregateVersion: z.number().int().nonnegative().nullable(),
  payload: attributesSchema,
  requestId: z.string().min(1),
  status: outboxEventStatusSchema,
  attempts: z.number().int().nonnegative(),
  availableAt: timestampSchema,
  publishedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});

export type EntityType = z.infer<typeof entityTypeSchema>;
export type EntityStatus = z.infer<typeof entityStatusSchema>;
export type Entity = z.infer<typeof entitySchema>;
export type EntityAlias = z.infer<typeof entityAliasSchema>;
export type Alias = EntityAlias;
export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;
export type Fact = z.infer<typeof factSchema>;
export type FactValueType = z.infer<typeof factValueTypeSchema>;
export type FactScope = z.infer<typeof factScopeSchema>;
export type FactStatus = z.infer<typeof factStatusSchema>;
export type EvidenceSourceKind = z.infer<typeof evidenceSourceKindSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type OutboxEvent = z.infer<typeof outboxEventSchema>;

export type PredicateDefinition = {
  valueType: FactValueType;
  scopes: FactScope[];
  entityTypes?: EntityType[];
  cardinality: "single" | "multi";
};

/**
 * The registry is intentionally code-owned. A client can select a predicate
 * from this set, but cannot create a new schema by sending an arbitrary path.
 */
export const predicateSchemaRegistry: Readonly<Record<string, PredicateDefinition>> = {
  "identity.age": { valueType: "number", scopes: ["base"], entityTypes: ["character"], cardinality: "single" },
  "identity.gender_expression": { valueType: "string", scopes: ["base"], entityTypes: ["character"], cardinality: "single" },
  "identity.occupation": { valueType: "string", scopes: ["base"], entityTypes: ["character"], cardinality: "single" },
  "appearance.face": { valueType: "string", scopes: ["base"], entityTypes: ["character"], cardinality: "single" },
  "appearance.hair": { valueType: "string", scopes: ["base", "scene"], entityTypes: ["character"], cardinality: "single" },
  "appearance.eye_color": { valueType: "string", scopes: ["base"], entityTypes: ["character"], cardinality: "single" },
  "appearance.body_type": { valueType: "string", scopes: ["base"], entityTypes: ["character"], cardinality: "single" },
  "appearance.distinctive_features": { valueType: "json", scopes: ["base", "scene"], entityTypes: ["character"], cardinality: "multi" },
  "personality.traits": { valueType: "json", scopes: ["base"], entityTypes: ["character"], cardinality: "multi" },
  "motivation.want": { valueType: "string", scopes: ["base"], entityTypes: ["character"], cardinality: "single" },
  "motivation.need": { valueType: "string", scopes: ["base"], entityTypes: ["character"], cardinality: "single" },
  "motivation.lie": { valueType: "string", scopes: ["base"], entityTypes: ["character"], cardinality: "single" },
  "background.summary": { valueType: "string", scopes: ["base"], entityTypes: ["character"], cardinality: "single" },
  "speech.style": { valueType: "string", scopes: ["base"], entityTypes: ["character"], cardinality: "single" },
  "visual.default_wardrobe": { valueType: "string", scopes: ["base"], entityTypes: ["character"], cardinality: "single" },
  "voice.language": { valueType: "string", scopes: ["base"], entityTypes: ["character"], cardinality: "single" },
  "voice.timbre": { valueType: "string", scopes: ["base"], entityTypes: ["character"], cardinality: "single" },
  "wardrobe.current": { valueType: "string", scopes: ["scene", "range"], entityTypes: ["character"], cardinality: "single" },
  "state.hair": { valueType: "string", scopes: ["scene", "range"], entityTypes: ["character"], cardinality: "single" },
  "state.injury": { valueType: "string", scopes: ["scene", "range"], entityTypes: ["character"], cardinality: "single" },
  "state.location": { valueType: "entity_ref", scopes: ["scene", "range"], cardinality: "single" },
  "state.held_prop": { valueType: "entity_ref", scopes: ["scene", "range"], entityTypes: ["character"], cardinality: "multi" },
};

// Upper-case alias makes the registry easy to discover for non-UI callers.
export const PREDICATE_SCHEMA_REGISTRY = predicateSchemaRegistry;

const requestIdSchema = z.string().trim().min(1, "requestId is required").max(200);
const actorIdSchema = z.string().trim().min(1).max(200).default("local-user");

export const createEntityInputSchema = z.object({
  type: entityTypeSchema,
  entityType: entityTypeSchema.optional(),
  canonicalName: z.string().trim().min(1, "Canonical name is required").max(200),
  status: entityStatusSchema.optional().default("draft"),
  mergedIntoEntityId: uuidSchema.nullable().optional().default(null),
  attributes: attributesSchema.optional().default({}),
  schemaVersion: z.number().int().positive().optional().default(1),
  requestId: requestIdSchema.optional(),
  actorId: actorIdSchema,
}).strict().superRefine((value, context) => {
  if (value.entityType !== undefined && value.type !== value.entityType) {
    context.addIssue({ code: "custom", path: ["entityType"], message: "type and entityType must match" });
  }
});

export const updateEntityInputSchema = z.object({
  canonicalName: z.string().trim().min(1).max(200).optional(),
  status: entityStatusSchema.optional(),
  mergedIntoEntityId: uuidSchema.nullable().optional(),
  attributes: attributesSchema.optional(),
  baseVersion: z.number().int().positive().optional(),
  expectedVersion: z.number().int().positive().optional(),
  requestId: requestIdSchema.optional(),
  actorId: actorIdSchema,
}).strict().superRefine((value, context) => {
  if (value.baseVersion !== undefined && value.expectedVersion !== undefined && value.baseVersion !== value.expectedVersion) {
    context.addIssue({ code: "custom", path: ["expectedVersion"], message: "baseVersion and expectedVersion must match" });
  }
  if (value.canonicalName === undefined && value.status === undefined && value.mergedIntoEntityId === undefined && value.attributes === undefined) {
    context.addIssue({ code: "custom", path: [], message: "At least one entity field is required" });
  }
});

export const createEntityAliasInputSchema = z.object({
  alias: z.string().trim().min(1, "Alias is required").max(200),
  locale: z.string().trim().max(40).nullable().optional().default(null),
  requestId: requestIdSchema.optional(),
  actorId: actorIdSchema,
}).strict();

export const createEvidenceSourceInputSchema = z.object({
  kind: evidenceSourceKindSchema,
  documentId: uuidSchema.nullable().optional().default(null),
  sceneId: uuidSchema.nullable().optional().default(null),
  /** revisionId is retained as an API alias; both names mean scene revision. */
  revisionId: uuidSchema.nullable().optional(),
  sceneRevisionId: uuidSchema.nullable().optional(),
  anchorStart: z.string().trim().max(500).nullable().optional().default(null),
  anchorEnd: z.string().trim().max(500).nullable().optional().default(null),
  quotedText: z.string().max(20_000).nullable().optional().default(null),
  createdByUserId: z.string().trim().max(200).nullable().optional().default(null),
  modelRunId: z.string().trim().max(200).nullable().optional().default(null),
  requestId: requestIdSchema.optional(),
  actorId: actorIdSchema,
}).strict().superRefine((value, context) => {
  if (value.revisionId !== undefined && value.sceneRevisionId !== undefined && value.revisionId !== value.sceneRevisionId) {
    context.addIssue({ code: "custom", path: ["sceneRevisionId"], message: "revisionId and sceneRevisionId must match" });
  }
});

export const createFactInputSchema = z.object({
  subjectEntityId: uuidSchema,
  predicate: z.string().trim().min(1).max(200),
  value: z.unknown(),
  valueType: factValueTypeSchema,
  truthClass: z.literal("canon").optional().default("canon"),
  scope: factScopeSchema,
  sceneId: uuidSchema.nullable().optional().default(null),
  validFromSceneId: uuidSchema.nullable().optional().default(null),
  validToSceneId: uuidSchema.nullable().optional().default(null),
  sourceId: uuidSchema,
  supersedesFactId: uuidSchema.nullable().optional().default(null),
  baseVersion: z.number().int().positive().optional(),
  expectedVersion: z.number().int().positive().optional(),
  requestId: requestIdSchema.optional(),
  actorId: actorIdSchema,
}).strict().superRefine((value, context) => {
  if (value.baseVersion !== undefined && value.expectedVersion !== undefined && value.baseVersion !== value.expectedVersion) {
    context.addIssue({ code: "custom", path: ["expectedVersion"], message: "baseVersion and expectedVersion must match" });
  }
});

export const supersedeFactInputSchema = z.object({
  value: z.unknown(),
  valueType: factValueTypeSchema,
  scope: factScopeSchema.optional(),
  sceneId: uuidSchema.nullable().optional(),
  validFromSceneId: uuidSchema.nullable().optional(),
  validToSceneId: uuidSchema.nullable().optional(),
  sourceId: uuidSchema,
  baseVersion: z.number().int().positive().optional(),
  expectedVersion: z.number().int().positive().optional(),
  requestId: requestIdSchema.optional(),
  actorId: actorIdSchema,
}).strict().superRefine((value, context) => {
  if (value.baseVersion !== undefined && value.expectedVersion !== undefined && value.baseVersion !== value.expectedVersion) {
    context.addIssue({ code: "custom", path: ["expectedVersion"], message: "baseVersion and expectedVersion must match" });
  }
});

export const retractFactInputSchema = z.object({
  baseVersion: z.number().int().positive().optional(),
  expectedVersion: z.number().int().positive().optional(),
  requestId: requestIdSchema.optional(),
  actorId: actorIdSchema,
}).strict().superRefine((value, context) => {
  if (value.baseVersion !== undefined && value.expectedVersion !== undefined && value.baseVersion !== value.expectedVersion) {
    context.addIssue({ code: "custom", path: ["expectedVersion"], message: "baseVersion and expectedVersion must match" });
  }
});

export type CreateEntityInput = z.input<typeof createEntityInputSchema>;
export type UpdateEntityInput = z.input<typeof updateEntityInputSchema>;
export type CreateEntityAliasInput = z.input<typeof createEntityAliasInputSchema>;
export type CreateEvidenceSourceInput = z.input<typeof createEvidenceSourceInputSchema>;
export type CreateFactInput = z.input<typeof createFactInputSchema>;
export type SupersedeFactInput = z.input<typeof supersedeFactInputSchema>;
export type RetractFactInput = z.input<typeof retractFactInputSchema>;

export function normalizeAlias(alias: string) {
  return alias.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/gu, " ");
}

export function getPredicateDefinition(predicate: string) {
  return predicateSchemaRegistry[predicate];
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).every(isJsonValue);
  return false;
}

export function validatePredicateValue(input: {
  predicate: string;
  value: unknown;
  valueType: FactValueType;
  scope: FactScope;
  entityType?: EntityType;
}) {
  const definition = getPredicateDefinition(input.predicate);
  if (!definition) return { ok: false as const, message: `Unknown predicate: ${input.predicate}` };
  if (definition.valueType !== input.valueType) {
    return { ok: false as const, message: `Predicate ${input.predicate} requires valueType ${definition.valueType}` };
  }
  if (!definition.scopes.includes(input.scope)) {
    return { ok: false as const, message: `Predicate ${input.predicate} cannot use scope ${input.scope}` };
  }
  if (definition.entityTypes && input.entityType && !definition.entityTypes.includes(input.entityType)) {
    return { ok: false as const, message: `Predicate ${input.predicate} cannot be attached to ${input.entityType}` };
  }
  if (!isJsonValue(input.value)) {
    return { ok: false as const, message: "Fact value must be JSON-serializable" };
  }
  if (input.valueType === "string" && typeof input.value !== "string") {
    return { ok: false as const, message: "Fact value must be a string" };
  }
  if (input.valueType === "number" && (typeof input.value !== "number" || !Number.isFinite(input.value))) {
    return { ok: false as const, message: "Fact value must be a finite number" };
  }
  if (input.valueType === "boolean" && typeof input.value !== "boolean") {
    return { ok: false as const, message: "Fact value must be a boolean" };
  }
  if (input.valueType === "entity_ref" && (typeof input.value !== "string" || !uuidSchema.safeParse(input.value).success)) {
    return { ok: false as const, message: "Fact entity_ref value must be a UUID" };
  }
  return { ok: true as const, definition };
}
