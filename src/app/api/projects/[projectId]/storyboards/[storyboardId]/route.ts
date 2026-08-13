import { NextResponse } from "next/server";
import { getStoryboard } from "@/server/db/storyboard";
import { notFoundResponse, routeErrorResponse, validationResponse } from "@/server/http";
import { z } from "zod";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ projectId: string; storyboardId: string }> };
const paramsSchema = z.object({ projectId: z.string().uuid(), storyboardId: z.string().uuid() }).strict();

export async function GET(_request: Request, context: RouteContext) {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return validationResponse(parsed.error);
  const { projectId, storyboardId } = parsed.data;
  try {
    const storyboard = getStoryboard(storyboardId, projectId);
    if (!storyboard) return notFoundResponse("Storyboard not found");
    return NextResponse.json({ data: { storyboard } });
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/storyboards/${storyboardId}`, error);
  }
}
