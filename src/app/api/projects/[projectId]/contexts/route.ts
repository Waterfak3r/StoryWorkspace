import { NextResponse } from "next/server";
import { contextPolicyIdSchema, contextPurposeSchema } from "@/domain/context-builder";
import { listContextSnapshots } from "@/server/db/context-builder";
import { routeErrorResponse, validationResponse } from "@/server/http";
import { z } from "zod";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string }> };
const projectIdSchema = z.string().uuid();
const querySchema = z.object({
  sceneId: z.string().uuid().optional(),
  sceneRevisionId: z.string().uuid().optional(),
  purpose: contextPurposeSchema.optional(),
  policyId: contextPolicyIdSchema.optional(),
  latest: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
}).strict().superRefine((value, context) => {
  if (value.purpose && value.policyId) {
    const expected = value.purpose === "storyboard" ? "storyboard-default-v1" : "video-default-v1";
    if (value.policyId !== expected) context.addIssue({ code: "custom", path: ["policyId"], message: "policyId must match purpose" });
  }
});

export async function GET(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const project = projectIdSchema.safeParse(projectId);
  if (!project.success) return validationResponse(project.error);
  const search = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse(Object.fromEntries(search.entries()));
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    return NextResponse.json({ data: { snapshots: listContextSnapshots(project.data, parsed.data) } });
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/contexts`, error);
  }
}
