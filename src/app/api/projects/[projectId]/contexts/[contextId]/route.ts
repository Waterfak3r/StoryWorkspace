import { NextResponse } from "next/server";
import { getContextSnapshot } from "@/server/db/context-builder";
import { notFoundResponse, routeErrorResponse, validationResponse } from "@/server/http";
import { z } from "zod";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string; contextId: string }> };
const uuidSchema = z.string().uuid();

export async function GET(_request: Request, context: RouteContext) {
  const { projectId, contextId } = await context.params;
  const parsed = z.object({ projectId: uuidSchema, contextId: uuidSchema }).safeParse({ projectId, contextId });
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    const snapshot = getContextSnapshot(parsed.data.contextId, parsed.data.projectId);
    if (!snapshot) return notFoundResponse("Context snapshot not found");
    return NextResponse.json({ data: { snapshot } });
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/contexts/${contextId}`, error);
  }
}
