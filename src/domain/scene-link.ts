import { z } from "zod";
import { analysisEntityTypeSchema } from "./analysis";

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });

export const sceneEntityLinkRoleSchema = z.enum(["appears", "located_at", "used", "mentioned"]);
export const sceneEntityLinkStatusSchema = z.enum(["candidate", "confirmed", "rejected", "stale"]);

export const sceneEntityLinkSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  sceneId: uuidSchema,
  sceneRevisionId: uuidSchema,
  entityId: uuidSchema,
  entityType: analysisEntityTypeSchema,
  role: sceneEntityLinkRoleSchema,
  status: sceneEntityLinkStatusSchema,
  resolver: z.enum(["exact_alias", "explicit_stub", "user"]),
  confidence: z.number().min(0).max(1).nullable(),
  version: z.number().int().positive(),
  candidateGroupId: uuidSchema,
  fingerprint: z.string().min(1),
  analysisRunId: uuidSchema.nullable(),
  mentionIds: z.array(uuidSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const sceneEntityLinkMentionSchema = z.object({
  projectId: uuidSchema,
  linkId: uuidSchema,
  mentionId: uuidSchema,
  createdAt: timestampSchema,
});

export const reviewSceneEntityLinkInputSchema = z.object({
  status: z.enum(["confirmed", "rejected"]).optional(),
  decision: z.enum(["confirm", "reject"]).optional(),
  expectedVersion: z.number().int().positive(),
  expectedSceneRevisionId: uuidSchema,
  requestId: z.string().trim().min(1).max(200),
  actorId: z.string().trim().min(1).max(200).optional().default("local-user"),
}).strict().superRefine((value, context) => {
  if (value.status === undefined && value.decision === undefined) {
    context.addIssue({ code: "custom", path: ["status"], message: "status or decision is required" });
  }
  if (value.status !== undefined && value.decision !== undefined) {
    const expected = value.decision === "confirm" ? "confirmed" : "rejected";
    if (value.status !== expected) context.addIssue({ code: "custom", path: ["decision"], message: "status and decision must match" });
  }
});

export type SceneEntityLinkRole = z.infer<typeof sceneEntityLinkRoleSchema>;
export type SceneEntityLinkStatus = z.infer<typeof sceneEntityLinkStatusSchema>;
export type SceneEntityLink = z.infer<typeof sceneEntityLinkSchema>;
export type SceneEntityLinkMention = z.infer<typeof sceneEntityLinkMentionSchema>;
export type ReviewSceneEntityLinkInput = z.input<typeof reviewSceneEntityLinkInputSchema>;

export function sceneEntityLinkRoleForType(type: z.infer<typeof analysisEntityTypeSchema>): SceneEntityLinkRole {
  if (type === "character") return "appears";
  if (type === "location") return "located_at";
  return "used";
}
