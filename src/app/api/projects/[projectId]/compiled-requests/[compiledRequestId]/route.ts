import { NextResponse } from "next/server";
import { getCompiledGenerationRequest } from "@/server/db/generation-compiler";
import { notFoundResponse, routeErrorResponse, validationResponse } from "@/server/http";
import { z } from "zod";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ projectId: string; compiledRequestId: string }> };
const paramsSchema = z.object({ projectId: z.string().uuid(), compiledRequestId: z.string().uuid() }).strict();

export async function GET(_request: Request, context: RouteContext) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) return validationResponse(parsedParams.error);
  const { projectId, compiledRequestId } = parsedParams.data;
  try {
    const result = getCompiledGenerationRequest(compiledRequestId, projectId);
    if (!result) return notFoundResponse("Compiled generation request not found");
    return NextResponse.json({ data: result });
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/compiled-requests/${compiledRequestId}`, error);
  }
}
