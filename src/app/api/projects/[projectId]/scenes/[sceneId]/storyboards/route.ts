import { NextResponse } from "next/server";
import { createStoryboardInputSchema, storyboardStatusSchema } from "@/domain/storyboard";
import { createStoryboard, listStoryboards } from "@/server/db/storyboard";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";
import { z } from "zod";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ projectId: string; sceneId: string }> };
const paramsSchema = z.object({ projectId: z.string().uuid(), sceneId: z.string().uuid() }).strict();
const querySchema = z.object({
  contextSnapshotId: z.string().uuid().optional(),
  status: storyboardStatusSchema.optional(),
}).strict();

export async function GET(request: Request, context: RouteContext) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) return validationResponse(parsedParams.error);
  const parsedQuery = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsedQuery.success) return validationResponse(parsedQuery.error);
  const { projectId, sceneId } = parsedParams.data;
  try {
    return NextResponse.json({ data: { storyboards: listStoryboards(projectId, sceneId, parsedQuery.data) } });
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/scenes/${sceneId}/storyboards`, error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) return validationResponse(parsedParams.error);
  const parsedBody = createStoryboardInputSchema.safeParse(await readJson(request));
  if (!parsedBody.success) return validationResponse(parsedBody.error);
  const { projectId, sceneId } = parsedParams.data;
  try {
    const result = createStoryboard(projectId, sceneId, parsedBody.data);
    return NextResponse.json({ data: result }, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    return routeErrorResponse("POST", `/api/projects/${projectId}/scenes/${sceneId}/storyboards`, error);
  }
}
