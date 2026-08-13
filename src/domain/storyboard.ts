import { z } from "zod";

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const requestIdSchema = z.string().trim().min(1, "requestId is required").max(200);
const shortTextSchema = z.string().trim().min(1).max(1_000);

export const storyboardStatusSchema = z.enum(["draft", "approved", "superseded"]);
export const shotFramingRoleSchema = z.enum(["primary", "secondary", "background"]);

export const shotSubjectSchema = z.object({
  entityId: uuidSchema,
  action: shortTextSchema,
  expression: z.string().trim().max(500).nullable().optional().default(null),
  framingRole: shotFramingRoleSchema,
}).strict();

export const shotSpecContentSchema = z.object({
  ordinal: z.number().int().positive().max(1_000),
  narrativePurpose: shortTextSchema,
  subjects: z.array(shotSubjectSchema).min(1).max(20),
  locationEntityId: uuidSchema.nullable().optional().default(null),
  propEntityIds: z.array(uuidSchema).max(20).optional().default([]),
  framing: z.string().trim().max(500).nullable().optional().default(null),
  cameraMotion: z.string().trim().max(500).nullable().optional().default(null),
  lens: z.string().trim().max(200).nullable().optional().default(null),
  durationSeconds: z.number().positive().max(60).nullable().optional().default(null),
  dialogueLineIds: z.array(uuidSchema).max(100).optional().default([]),
  continuityConstraints: z.array(z.string().trim().min(1).max(1_000)).max(100).optional().default([]),
  negativeConstraints: z.array(z.string().trim().min(1).max(1_000)).max(100).optional().default([]),
}).strict().superRefine((value, context) => {
  if (new Set(value.subjects.map((subject) => subject.entityId)).size !== value.subjects.length) {
    context.addIssue({ code: "custom", path: ["subjects"], message: "subjects must reference unique entities" });
  }
  if (new Set(value.propEntityIds).size !== value.propEntityIds.length) {
    context.addIssue({ code: "custom", path: ["propEntityIds"], message: "propEntityIds must be unique" });
  }
  if (new Set(value.dialogueLineIds).size !== value.dialogueLineIds.length) {
    context.addIssue({ code: "custom", path: ["dialogueLineIds"], message: "dialogueLineIds must be unique" });
  }
});

export type ShotSpecContent = z.infer<typeof shotSpecContentSchema>;
export type ShotSubject = z.infer<typeof shotSubjectSchema>;

export const shotSpecSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  storyboardId: uuidSchema,
  sceneId: uuidSchema,
  spec: shotSpecContentSchema,
  specHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: timestampSchema,
}).strict();

export type ShotSpec = z.infer<typeof shotSpecSchema>;

export const storyboardSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  sceneId: uuidSchema,
  sceneRevisionId: uuidSchema,
  contextSnapshotId: uuidSchema,
  title: z.string().trim().min(1).max(300),
  status: storyboardStatusSchema,
  version: z.number().int().positive(),
  supersedesStoryboardId: uuidSchema.nullable(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  shots: z.array(shotSpecSchema).min(1).max(100),
  createdBy: z.string().min(1).max(200),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict();

export type Storyboard = z.infer<typeof storyboardSchema>;
export type StoryboardStatus = z.infer<typeof storyboardStatusSchema>;

export const createStoryboardInputSchema = z.object({
  contextSnapshotId: uuidSchema,
  title: z.string().trim().min(1).max(300),
  shots: z.array(shotSpecContentSchema).min(1).max(100),
  supersedesStoryboardId: uuidSchema.nullable().optional().default(null),
  expectedSupersededVersion: z.number().int().positive().nullable().optional().default(null),
  requestId: requestIdSchema,
  actorId: z.string().trim().min(1).max(200).optional().default("local-user"),
}).strict().superRefine((value, context) => {
  if (new Set(value.shots.map((shot) => shot.ordinal)).size !== value.shots.length) {
    context.addIssue({ code: "custom", path: ["shots"], message: "shot ordinals must be unique" });
  }
  if ((value.supersedesStoryboardId === null) !== (value.expectedSupersededVersion === null)) {
    context.addIssue({ code: "custom", path: ["expectedSupersededVersion"], message: "supersedesStoryboardId and expectedSupersededVersion must be provided together" });
  }
});

export type CreateStoryboardInput = z.input<typeof createStoryboardInputSchema>;
export type ParsedCreateStoryboardInput = z.output<typeof createStoryboardInputSchema>;

export const approveStoryboardInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  requestId: requestIdSchema,
  actorId: z.string().trim().min(1).max(200).optional().default("local-user"),
}).strict();

export type ApproveStoryboardInput = z.input<typeof approveStoryboardInputSchema>;
