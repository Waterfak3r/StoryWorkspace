import { z } from "zod";

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });

export const ADAPTATION_BODY_MAX_LENGTH = 100_000;

export const adaptationFormatSchema = z.literal("screenplay_scene");

export const adaptationSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  format: adaptationFormatSchema,
  title: z.string().min(1),
  body: z.string().max(ADAPTATION_BODY_MAX_LENGTH),
  position: z.number().int().nonnegative(),
  sourceGenerationId: uuidSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict();

const adaptationTitleSchema = z.string()
  .trim()
  .min(1, "Adaptation title is required")
  .max(160, "Adaptation title must be 160 characters or fewer");

const adaptationPositionSchema = z.number().int().nonnegative();

export const createManualAdaptationInputSchema = z.object({
  origin: z.literal("manual"),
  format: adaptationFormatSchema,
  title: adaptationTitleSchema,
  body: z.string().max(ADAPTATION_BODY_MAX_LENGTH, `Adaptation body must be ${ADAPTATION_BODY_MAX_LENGTH} characters or fewer`).default(""),
  position: adaptationPositionSchema.optional(),
}).strict();

export const createAiAdaptationInputSchema = z.object({
  origin: z.literal("ai"),
  format: adaptationFormatSchema,
  title: adaptationTitleSchema,
  generationId: uuidSchema,
  position: adaptationPositionSchema.optional(),
}).strict();

export const createAdaptationInputSchema = z.discriminatedUnion("origin", [
  createManualAdaptationInputSchema,
  createAiAdaptationInputSchema,
]);

export const updateAdaptationInputSchema = z.object({
  baseUpdatedAt: timestampSchema,
  title: adaptationTitleSchema.optional(),
  body: z.string().max(ADAPTATION_BODY_MAX_LENGTH, `Adaptation body must be ${ADAPTATION_BODY_MAX_LENGTH} characters or fewer`).optional(),
  position: adaptationPositionSchema.optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "baseUpdatedAt"), {
  message: "At least one adaptation field is required alongside baseUpdatedAt",
});

export type Adaptation = z.infer<typeof adaptationSchema>;
export type CreateManualAdaptationInput = z.input<typeof createManualAdaptationInputSchema>;
export type CreateAiAdaptationInput = z.input<typeof createAiAdaptationInputSchema>;
export type CreateAdaptationInput = z.input<typeof createAdaptationInputSchema>;
export type UpdateAdaptationInput = z.input<typeof updateAdaptationInputSchema>;
