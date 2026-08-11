import { NextResponse } from "next/server";
import { listSceneEntityLinks } from "@/server/db/scene-link";
import { routeErrorResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string; sceneId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { projectId, sceneId } = await context.params;
  const search = new URL(request.url).searchParams;
  try {
    return NextResponse.json({ data: { links: listSceneEntityLinks(projectId, sceneId, { sceneRevisionId: search.get("sceneRevisionId") ?? undefined, status: (search.get("status") as "candidate" | "confirmed" | "rejected" | "stale" | null) ?? undefined }) } });
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/scenes/${sceneId}/entity-links`, error);
  }
}
