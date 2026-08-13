import { NextResponse } from "next/server";
import { getGenerationRecord } from "@/server/db/generation";
import { notFoundResponse, routeErrorResponse, validationResponse } from "@/server/http";
import { z } from "zod";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ projectId: string; manifestId: string }> };
const paramsSchema = z.object({ projectId: z.string().uuid(), manifestId: z.string().uuid() }).strict();
const querySchema = z.object({}).strict();

export async function GET(request: Request, context: RouteContext) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) return validationResponse(parsedParams.error);
  const parsedQuery = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsedQuery.success) return validationResponse(parsedQuery.error);
  const { projectId, manifestId } = parsedParams.data;
  try {
    const result = getGenerationRecord(manifestId, projectId);
    if (!result) return notFoundResponse("Generation Manifest not found");
    return NextResponse.json({ data: result });
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/generations/${manifestId}`, error);
  }
}
