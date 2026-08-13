import { NextResponse } from "next/server";
import { resolveSceneStateQuerySchema } from "@/domain/scene-state";
import { resolveSceneState } from "@/server/db/scene-state";
import { routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string; sceneId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { projectId, sceneId } = await context.params;
  const search = new URL(request.url).searchParams;
  const parsed = resolveSceneStateQuerySchema.safeParse({
    sceneRevisionId: search.get("sceneRevisionId"),
    entityId: search.get("entityId") ?? undefined,
  });
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    return NextResponse.json({ data: resolveSceneState(projectId, sceneId, parsed.data.sceneRevisionId, parsed.data.entityId) });
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/scenes/${sceneId}/resolved-state`, error);
  }
}
