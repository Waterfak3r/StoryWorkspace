import { NextResponse } from "next/server";
import { proposeStatePatchInputSchema } from "@/domain/scene-state";
import { proposeStatePatch } from "@/server/db/canon-patch";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string; sceneId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { projectId, sceneId } = await context.params;
  const body = await readJson(request);
  const parsed = proposeStatePatchInputSchema.safeParse(body && typeof body === "object" && !Array.isArray(body) ? { ...body as Record<string, unknown>, sceneId } : body);
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    const result = proposeStatePatch(projectId, parsed.data);
    return NextResponse.json({ data: result }, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    return routeErrorResponse("POST", `/api/projects/${projectId}/scenes/${sceneId}/state-patches`, error);
  }
}
