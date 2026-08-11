import { z } from "zod";

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
export const contextReferenceIdsSchema = z.array(uuidSchema);
export const CHAPTER_BODY_MAX_LENGTH = 100_000;

export const bibleCategorySchema = z.enum(["world", "character", "location", "rule", "theme"]);
export const outlineKindSchema = z.enum(["story", "act", "chapter", "scene"]);
export const chapterStatusSchema = z.enum(["planned", "draft", "revised", "final"]);
export const chapterVersionSourceSchema = z.enum(["manual", "restore_backup", "ai"]);

export const bibleEntrySchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  category: bibleCategorySchema,
  title: z.string().min(1),
  body: z.string(),
  position: z.number().int().nonnegative(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const outlineNodeSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  parentId: uuidSchema.nullable(),
  kind: outlineKindSchema,
  title: z.string().min(1),
  summary: z.string(),
  position: z.number().int().nonnegative(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const chapterSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  outlineNodeId: uuidSchema.nullable(),
  title: z.string().min(1),
  summary: z.string(),
  body: z.string(),
  position: z.number().int().nonnegative(),
  status: chapterStatusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const chapterVersionSchema = z.object({
  id: uuidSchema,
  chapterId: uuidSchema,
  body: z.string(),
  source: chapterVersionSourceSchema,
  aiAction: z.string().nullable(),
  instruction: z.string().nullable(),
  contextReferenceIds: contextReferenceIdsSchema,
  createdAt: timestampSchema,
});

export const createBibleEntryInputSchema = z.object({
  category: bibleCategorySchema,
  title: z.string().trim().min(1, "Bible entry title is required").max(160, "Bible entry title must be 160 characters or fewer"),
  body: z.string().max(20000, "Bible entry body must be 20,000 characters or fewer").default(""),
  position: z.number().int().nonnegative().optional(),
}).strict();

export const updateBibleEntryInputSchema = z.object({
  category: bibleCategorySchema.optional(),
  title: z.string().trim().min(1, "Bible entry title is required").max(160, "Bible entry title must be 160 characters or fewer").optional(),
  body: z.string().max(20000, "Bible entry body must be 20,000 characters or fewer").optional(),
  position: z.number().int().nonnegative().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one bible entry field is required",
});

export const createOutlineNodeInputSchema = z.object({
  parentId: uuidSchema.nullable().optional().default(null),
  kind: outlineKindSchema,
  title: z.string().trim().min(1, "Outline title is required").max(160, "Outline title must be 160 characters or fewer"),
  summary: z.string().trim().max(4000, "Outline summary must be 4,000 characters or fewer").default(""),
  position: z.number().int().nonnegative().optional(),
}).strict();

export const updateOutlineNodeInputSchema = z.object({
  parentId: uuidSchema.nullable().optional(),
  kind: outlineKindSchema.optional(),
  title: z.string().trim().min(1, "Outline title is required").max(160, "Outline title must be 160 characters or fewer").optional(),
  summary: z.string().trim().max(4000, "Outline summary must be 4,000 characters or fewer").optional(),
  position: z.number().int().nonnegative().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one outline node field is required",
});

const outlineOrderItemSchema = z.object({
  id: uuidSchema,
  position: z.number().int().nonnegative(),
}).strict();

export const outlineOrderInputSchema = z.union([
  z.object({ orderedIds: z.array(uuidSchema) }).strict(),
  z.object({ items: z.array(outlineOrderItemSchema) }).strict(),
]);

export const createChapterInputSchema = z.object({
  outlineNodeId: uuidSchema.nullable().optional().default(null),
  title: z.string().trim().min(1, "Chapter title is required").max(160, "Chapter title must be 160 characters or fewer"),
  summary: z.string().trim().max(4000, "Chapter summary must be 4,000 characters or fewer").default(""),
  body: z.string().max(CHAPTER_BODY_MAX_LENGTH, `Chapter body must be ${CHAPTER_BODY_MAX_LENGTH} characters or fewer`).default(""),
  position: z.number().int().nonnegative().optional(),
  status: chapterStatusSchema.optional().default("planned"),
}).strict();

export const updateChapterInputSchema = z.object({
  baseUpdatedAt: timestampSchema,
  outlineNodeId: uuidSchema.nullable().optional(),
  title: z.string().trim().min(1, "Chapter title is required").max(160, "Chapter title must be 160 characters or fewer").optional(),
  summary: z.string().trim().max(4000, "Chapter summary must be 4,000 characters or fewer").optional(),
  body: z.string().max(CHAPTER_BODY_MAX_LENGTH, `Chapter body must be ${CHAPTER_BODY_MAX_LENGTH} characters or fewer`).optional(),
  position: z.number().int().nonnegative().optional(),
  status: chapterStatusSchema.optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "baseUpdatedAt"), {
  message: "At least one chapter field is required alongside baseUpdatedAt",
});

export const createChapterVersionInputSchema = z.object({
  source: z.enum(["manual", "ai"]).default("manual"),
  aiAction: z.string().trim().max(80, "AI action must be 80 characters or fewer").optional(),
  instruction: z.string().trim().max(10000, "Version instruction must be 10,000 characters or fewer").optional(),
  contextReferenceIds: contextReferenceIdsSchema.max(100, "No more than 100 context references may be stored").default([]),
}).strict();

// Browser callers can only request a manual snapshot. AI provenance is written
// by the server-side generation acceptance flow, not accepted from request JSON.
export const createManualChapterVersionInputSchema = z.object({
  source: z.literal("manual").optional(),
}).strict();

export const restoreChapterInputSchema = z.object({
  versionId: uuidSchema,
  baseUpdatedAt: timestampSchema,
}).strict();

export type BibleCategory = z.infer<typeof bibleCategorySchema>;
export type BibleEntry = z.infer<typeof bibleEntrySchema>;
export type CreateBibleEntryInput = z.input<typeof createBibleEntryInputSchema>;
export type UpdateBibleEntryInput = z.input<typeof updateBibleEntryInputSchema>;
export type OutlineKind = z.infer<typeof outlineKindSchema>;
export type OutlineNode = z.infer<typeof outlineNodeSchema>;
export type CreateOutlineNodeInput = z.input<typeof createOutlineNodeInputSchema>;
export type UpdateOutlineNodeInput = z.input<typeof updateOutlineNodeInputSchema>;
export type OutlineOrderInput = z.infer<typeof outlineOrderInputSchema>;
export type ChapterStatus = z.infer<typeof chapterStatusSchema>;
export type Chapter = z.infer<typeof chapterSchema>;
export type CreateChapterInput = z.input<typeof createChapterInputSchema>;
export type UpdateChapterInput = z.input<typeof updateChapterInputSchema>;
export type ChapterVersion = z.infer<typeof chapterVersionSchema>;
export type CreateChapterVersionInput = z.input<typeof createChapterVersionInputSchema>;
export type RestoreChapterInput = z.infer<typeof restoreChapterInputSchema>;
