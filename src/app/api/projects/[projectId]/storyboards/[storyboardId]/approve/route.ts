import { NextResponse } from "next/server";
import { approveStoryboardInputSchema } from "@/domain/storyboard";
import { approveStoryboard } from "@/server/db/storyboard";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";
import { z } from "zod";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ projectId: string; storyboardId: string }> };
const paramsSchema = z.object({ projectId: z.string().uuid(), storyboardId: z.string().uuid() }).strict();

export async function POST(request: Request, context: RouteContext) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) return validationResponse(parsedParams.error);
  const parsedBody = approveStoryboardInputSchema.safeParse(await readJson(request));
  if (!parsedBody.success) return validationResponse(parsedBody.error);
  const { projectId, storyboardId } = parsedParams.data;
  try {
    const result = approveStoryboard(projectId, storyboardId, parsedBody.data);
    return NextResponse.json({ data: result });
  } catch (error) {
    return routeErrorResponse("POST", `/api/projects/${projectId}/storyboards/${storyboardId}/approve`, error);
  }
}
