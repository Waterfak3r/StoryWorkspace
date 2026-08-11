import { NextResponse } from "next/server";
import { updateEntityInputSchema } from "@/domain/story-bible";
import { getEntityForProject, updateEntity } from "@/server/db/story-bible";
import { notFoundResponse, readJson, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ entityId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { entityId } = await context.params;
  const projectId = new URL(_request.url).searchParams.get("projectId");
  if (!projectId) return validationResponse({ issues: [{ path: ["projectId"], message: "projectId is required" }] });
  try {
    const entity = getEntityForProject(projectId, entityId);
    return entity ? NextResponse.json({ data: { entity } }) : notFoundResponse("Entity not found");
  } catch (error) {
    return routeErrorResponse("GET", `/api/entities/${entityId}`, error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { entityId } = await context.params;
  const parsed = updateEntityInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationResponse(parsed.error);
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return validationResponse({ issues: [{ path: ["projectId"], message: "projectId is required" }] });
  try {
    getEntityForProject(projectId, entityId);
    const entity = updateEntity(entityId, parsed.data);
    return entity ? NextResponse.json({ data: { entity } }) : notFoundResponse("Entity not found");
  } catch (error) {
    return routeErrorResponse("PATCH", `/api/entities/${entityId}`, error);
  }
}
