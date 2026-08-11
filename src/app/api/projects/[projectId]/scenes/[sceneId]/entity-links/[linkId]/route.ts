import { NextResponse } from "next/server";
import { reviewSceneEntityLinkInputSchema } from "@/domain/scene-link";
import { getSceneEntityLink, reviewSceneEntityLink } from "@/server/db/scene-link";
import { readJson, routeErrorResponse, notFoundResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string; sceneId: string; linkId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { projectId, sceneId, linkId } = await context.params;
  const parsed = reviewSceneEntityLinkInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    const current = getSceneEntityLink(linkId, projectId);
    if (!current || current.sceneId !== sceneId) return notFoundResponse("Scene entity link not found");
    const link = reviewSceneEntityLink(linkId, parsed.data, projectId);
    return NextResponse.json({ data: { link } });
  } catch (error) {
    return routeErrorResponse("PATCH", `/api/projects/${projectId}/scenes/${sceneId}/entity-links/${linkId}`, error);
  }
}
export async function GET(_request: Request, context: RouteContext) {
  const { projectId, sceneId, linkId } = await context.params;
  try {
    const link = getSceneEntityLink(linkId, projectId);
    return link && link.sceneId === sceneId ? NextResponse.json({ data: { link } }) : notFoundResponse("Scene entity link not found");
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/scenes/${sceneId}/entity-links/${linkId}`, error);
  }
}
