import type { ZodType } from "zod";
import { z } from "zod";

import { entityKindSchema, studioIdSchema, studioTimestampSchema } from "../domain";

export type CompleteJson = (schema: ZodType, prompt: string) => Promise<unknown>;

export const proposedSceneSchema = z.strictObject({
  key: studioIdSchema,
  title: z.string().min(1),
  script: z.string(),
  intent: z.string(),
  characterNames: z.array(z.string()),
  locationName: z.string().nullable(),
  propNames: z.array(z.string()),
  costumeNames: z.array(z.string()),
  volumeName: z.string().default(""),
  chapterName: z.string().default(""),
});

export const proposedEntitySchema = z.strictObject({
  key: studioIdSchema,
  kind: entityKindSchema,
  name: z.string().min(1),
  description: z.string(),
});

export const llmParseProposalSchema = z.strictObject({
  proposedScenes: z.array(proposedSceneSchema),
  proposedEntities: z.array(proposedEntitySchema),
});

export const parseRunStatusSchema = z.enum(["pending", "confirmed", "rejected"]);

export const parseRunRecordSchema = z.strictObject({
  id: studioIdSchema,
  status: parseRunStatusSchema,
  sourceText: z.string(),
  proposedScenes: z.array(proposedSceneSchema),
  proposedEntities: z.array(proposedEntitySchema),
  createdAt: studioTimestampSchema,
  updatedAt: studioTimestampSchema,
});

export const parseTextInputSchema = z.strictObject({
  text: z
    .string()
    .trim()
    .min(1, "Paste some text to parse."),
});

export const confirmParseInputSchema = z.strictObject({
  overwriteCanon: z.array(z.string()).optional(),
  volumeId: studioIdSchema.optional(),
  chapterId: studioIdSchema.optional(),
});

export type ProposedScene = z.infer<typeof proposedSceneSchema>;
export type ProposedEntity = z.infer<typeof proposedEntitySchema>;
export type LlmParseProposal = z.infer<typeof llmParseProposalSchema>;
export type StudioParseRun = z.infer<typeof parseRunRecordSchema>;
export type StudioParseRunStatus = z.infer<typeof parseRunStatusSchema>;
export type ParseTextInput = z.input<typeof parseTextInputSchema>;
export type ConfirmParseInput = z.input<typeof confirmParseInputSchema>;
