import { z } from "zod";

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });

export const documentKindSchema = z.enum(["screenplay", "prose", "outline"]);
export const documentStatusSchema = z.enum(["active", "archived"]);
export const sceneStatusSchema = z.enum(["active", "deleted"]);

export const scriptDocumentSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  title: z.string().min(1),
  kind: documentKindSchema,
  status: documentStatusSchema,
  version: z.number().int().nonnegative(),
  currentRevisionId: uuidSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const sceneSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  documentId: uuidSchema,
  narrativeRank: z.number().int().nonnegative(),
  status: sceneStatusSchema,
  version: z.number().int().positive(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deletedAt: timestampSchema.nullable(),
});

export const sceneRevisionSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  documentId: uuidSchema,
  sceneId: uuidSchema,
  documentRevisionId: uuidSchema,
  narrativeRank: z.number().int().nonnegative(),
  title: z.string(),
  content: z.string(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: sceneStatusSchema,
  createdAt: timestampSchema,
});

export const documentRevisionSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  documentId: uuidSchema,
  revisionNumber: z.number().int().positive(),
  baseVersion: z.number().int().nonnegative(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdBy: z.string().min(1),
  requestId: z.string().min(1),
  createdAt: timestampSchema,
  sceneRevisions: z.array(sceneRevisionSchema),
});

const revisionSceneInputSchema = z.object({
  id: uuidSchema.optional(),
  sceneId: uuidSchema.optional(),
  title: z.string().max(300, "Scene title must be 300 characters or fewer").default(""),
  content: z.string().max(200_000, "Scene content must be 200,000 characters or fewer").default(""),
  narrativeRank: z.number().int().nonnegative().optional(),
  status: sceneStatusSchema.optional().default("active"),
}).strict().superRefine((value, context) => {
  if (value.id !== undefined && value.sceneId !== undefined && value.id !== value.sceneId) {
    context.addIssue({ code: "custom", path: ["sceneId"], message: "id and sceneId must match" });
  }
});

export const createScriptDocumentInputSchema = z.object({
  title: z.string().trim().min(1, "Document title is required").max(200, "Document title must be 200 characters or fewer"),
  kind: documentKindSchema.optional(),
  documentType: documentKindSchema.optional(),
  requestId: z.string().trim().max(200, "Request ID must be 200 characters or fewer").optional(),
  actorId: z.string().trim().max(200).optional(),
  scenes: z.array(revisionSceneInputSchema).max(500, "A document may contain at most 500 scenes").optional().default([]),
}).strict().superRefine((value, context) => {
  if (value.documentType !== undefined && value.kind !== undefined && value.kind !== value.documentType) {
    context.addIssue({ code: "custom", path: ["documentType"], message: "kind and documentType must match" });
  }
  const ids = value.scenes.flatMap((scene) => scene.id ? [scene.id] : []);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["scenes"], message: "Scene IDs must be unique within a document revision" });
  }
  const explicitRanks = value.scenes.flatMap((scene) => scene.narrativeRank === undefined ? [] : [scene.narrativeRank]);
  if (new Set(explicitRanks).size !== explicitRanks.length) {
    context.addIssue({ code: "custom", path: ["scenes"], message: "Scene narrative ranks must be unique" });
  }
});

export const createDocumentRevisionInputSchema = z.object({
  baseVersion: z.number().int().nonnegative().optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
  requestId: z.string().trim().max(200, "Request ID must be 200 characters or fewer").optional(),
  actorId: z.string().trim().max(200).optional(),
  scenes: z.array(revisionSceneInputSchema).max(500, "A document may contain at most 500 scenes"),
}).strict().superRefine((value, context) => {
  if (value.baseVersion !== undefined && value.expectedVersion !== undefined && value.baseVersion !== value.expectedVersion) {
    context.addIssue({ code: "custom", path: ["expectedVersion"], message: "baseVersion and expectedVersion must match" });
  }
  const ids = value.scenes.flatMap((scene) => scene.id ? [scene.id] : []);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["scenes"], message: "Scene IDs must be unique within a document revision" });
  }
  const explicitRanks = value.scenes.flatMap((scene) => scene.narrativeRank === undefined ? [] : [scene.narrativeRank]);
  if (new Set(explicitRanks).size !== explicitRanks.length) {
    context.addIssue({ code: "custom", path: ["scenes"], message: "Scene narrative ranks must be unique" });
  }
});

export const updateScriptDocumentInputSchema = z.object({
  title: z.string().trim().min(1, "Document title is required").max(200, "Document title must be 200 characters or fewer").optional(),
  status: documentStatusSchema.optional(),
  baseVersion: z.number().int().nonnegative().optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
  requestId: z.string().trim().max(200).optional(),
  actorId: z.string().trim().max(200).optional(),
}).strict().superRefine((value, context) => {
  if (value.baseVersion !== undefined && value.expectedVersion !== undefined && value.baseVersion !== value.expectedVersion) {
    context.addIssue({ code: "custom", path: ["expectedVersion"], message: "baseVersion and expectedVersion must match" });
  }
  if (value.title === undefined && value.status === undefined) {
    context.addIssue({ code: "custom", path: [], message: "At least one document field is required" });
  }
});

export type ScriptDocument = z.infer<typeof scriptDocumentSchema>;
export type DocumentStatus = z.infer<typeof documentStatusSchema>;
export type DocumentKind = z.infer<typeof documentKindSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type SceneStatus = z.infer<typeof sceneStatusSchema>;
export type SceneRevision = z.infer<typeof sceneRevisionSchema>;
export type DocumentRevision = z.infer<typeof documentRevisionSchema>;
export type RevisionSceneInput = z.infer<typeof revisionSceneInputSchema>;
export type CreateScriptDocumentInput = z.input<typeof createScriptDocumentInputSchema>;
export type CreateDocumentRevisionInput = z.input<typeof createDocumentRevisionInputSchema>;
export type UpdateScriptDocumentInput = z.input<typeof updateScriptDocumentInputSchema>;

/**
 * Canonical data used for a document content hash. IDs are deliberately kept
 * in the hash: a scene's identity is part of the immutable revision contract.
 */
export function canonicalDocumentScenes(scenes: Array<{
  id: string;
  narrativeRank: number;
  title: string;
  content: string;
  status: SceneStatus;
}>) {
  return scenes
    .slice()
    .sort((left, right) => left.narrativeRank - right.narrativeRank || left.id.localeCompare(right.id))
    .map((scene) => ({
      id: scene.id,
      narrativeRank: scene.narrativeRank,
      title: scene.title,
      content: scene.content,
      status: scene.status,
    }));
}
