import { NextResponse } from "next/server";
import { getSceneEntityLink } from "@/server/db/scene-link";
import { notFoundResponse, routeErrorResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string; linkId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { projectId, linkId } = await context.params;
  try {
    const link = getSceneEntityLink(linkId, projectId);
    return link ? NextResponse.json({ data: { link } }) : notFoundResponse("Scene entity link not found");
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/scene-entity-links/${linkId}`, error);
  }
}
