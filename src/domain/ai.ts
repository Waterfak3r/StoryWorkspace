import { z } from "zod";
import { CHAPTER_BODY_MAX_LENGTH, chapterSchema, chapterVersionSchema, bibleEntrySchema, outlineNodeSchema } from "./narrative";

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });

export const AI_LIMITS = {
  instruction: 4_000,
  selectedProse: 20_000,
  references: 50,
  resolvedContext: 80_000,
  generatedMarkdown: 30_000,
  promptGuidanceMarkdown: 24_000,
} as const;

export const aiActionSchema = z.enum([
  "brainstorm",
  "continue",
  "rewrite",
  "summarize",
  "consistency",
  "adapt",
]);

export const aiContextSchema = z.object({
  bibleEntryIds: z.array(uuidSchema).max(AI_LIMITS.references, `No more than ${AI_LIMITS.references} Bible references may be selected`),
  outlineNodeIds: z.array(uuidSchema).max(AI_LIMITS.references, `No more than ${AI_LIMITS.references} outline references may be selected`),
  chapterIds: z.array(uuidSchema).max(AI_LIMITS.references, `No more than ${AI_LIMITS.references} chapter references may be selected`),
}).strict().superRefine((context, issueContext) => {
  const groups = [
    ["bibleEntryIds", context.bibleEntryIds],
    ["outlineNodeIds", context.outlineNodeIds],
    ["chapterIds", context.chapterIds],
  ] as const;
  const seen = new Set<string>();
  let total = 0;

  for (const [field, ids] of groups) {
    total += ids.length;
    for (const [index, id] of ids.entries()) {
      if (seen.has(id)) {
        issueContext.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field, index],
          message: "Context references must be unique across all groups",
        });
      }
      seen.add(id);
    }
  }

  if (total > AI_LIMITS.references) {
    issueContext.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["context"],
      message: `No more than ${AI_LIMITS.references} context references may be selected`,
    });
  }
});

export const aiGenerateInputSchema = z.object({
  projectId: uuidSchema,
  targetChapterId: uuidSchema,
  action: aiActionSchema,
  instruction: z.string().trim().min(1, "Instruction is required").max(AI_LIMITS.instruction, `Instruction must be ${AI_LIMITS.instruction} characters or fewer`),
  context: aiContextSchema,
  selectedProse: z.string().max(AI_LIMITS.selectedProse, `Selected prose must be ${AI_LIMITS.selectedProse} characters or fewer`).optional(),
}).strict().superRefine((input, issueContext) => {
  if (input.action === "rewrite" && !input.selectedProse?.trim()) {
    issueContext.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["selectedProse"],
      message: "Rewrite requires selected prose",
    });
  }
});

export const aiAcceptInputSchema = z.object({
  generationId: uuidSchema,
  body: z.string().max(CHAPTER_BODY_MAX_LENGTH, `Chapter body must be ${CHAPTER_BODY_MAX_LENGTH} characters or fewer`),
  baseUpdatedAt: timestampSchema,
}).strict();

export const createAiGenerationInputSchema = z.object({
  projectId: uuidSchema,
  targetChapterId: uuidSchema,
  action: aiActionSchema,
  instruction: z.string().max(AI_LIMITS.instruction),
  contextReferenceIds: z.array(uuidSchema),
  generatedMarkdown: z.string().max(AI_LIMITS.generatedMarkdown),
}).strict();

export const aiReferenceGroupSchema = z.enum(["bible", "outline", "chapter"]);

export const aiReferenceSummarySchema = z.object({
  id: uuidSchema,
  group: aiReferenceGroupSchema,
  title: z.string().min(1),
  subtype: z.string().min(1),
}).strict();

export const aiGenerationSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  targetChapterId: uuidSchema,
  action: aiActionSchema,
  instruction: z.string().max(AI_LIMITS.instruction),
  contextReferenceIds: z.array(uuidSchema),
  generatedMarkdown: z.string().max(AI_LIMITS.generatedMarkdown),
  createdAt: timestampSchema,
  acceptedVersionId: uuidSchema.nullable(),
}).strict();

export const aiGenerateResponseSchema = z.object({
  generation: aiGenerationSchema,
  references: z.array(aiReferenceSummarySchema),
}).strict();

export const aiAcceptResponseSchema = z.object({
  chapter: chapterSchema,
  version: chapterVersionSchema,
  generation: aiGenerationSchema,
}).strict();

export type AiAction = z.infer<typeof aiActionSchema>;
export type AiContext = z.infer<typeof aiContextSchema>;
export type AiGenerateInput = z.input<typeof aiGenerateInputSchema>;
export type AiAcceptInput = z.input<typeof aiAcceptInputSchema>;
export type CreateAiGenerationInput = z.input<typeof createAiGenerationInputSchema>;
export type AiReferenceGroup = z.infer<typeof aiReferenceGroupSchema>;
export type AiReferenceSummary = z.infer<typeof aiReferenceSummarySchema>;
export type AiGeneration = z.infer<typeof aiGenerationSchema>;
export type AiGenerateResponse = z.infer<typeof aiGenerateResponseSchema>;
export type AiAcceptResponse = z.infer<typeof aiAcceptResponseSchema>;
export type ResolvedBibleEntry = z.infer<typeof bibleEntrySchema>;
export type ResolvedOutlineNode = z.infer<typeof outlineNodeSchema>;
export type ResolvedChapter = z.infer<typeof chapterSchema>;
