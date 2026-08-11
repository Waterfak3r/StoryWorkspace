import { NextResponse } from "next/server";
import { reviewSceneEntityLinkInputSchema } from "@/domain/scene-link";
import { getSceneEntityLink, reviewSceneEntityLink } from "@/server/db/scene-link";
import { readJson, routeErrorResponse, notFoundResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string; linkId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { projectId, linkId } = await context.params;
  const parsed = reviewSceneEntityLinkInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    if (!getSceneEntityLink(linkId, projectId)) return notFoundResponse("Scene entity link not found");
    const link = reviewSceneEntityLink(linkId, parsed.data, projectId);
    return NextResponse.json({ data: { link } });
  } catch (error) {
    return routeErrorResponse("POST", `/api/projects/${projectId}/scene-entity-links/${linkId}/review`, error);
  }
}
