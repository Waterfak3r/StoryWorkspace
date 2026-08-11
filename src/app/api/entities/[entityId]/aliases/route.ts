import { NextResponse } from "next/server";
import { createEntityAliasInputSchema } from "@/domain/story-bible";
import { createEntityAlias, listEntityAliases } from "@/server/db/story-bible";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ entityId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { entityId } = await context.params;
  const projectId = new URL(_request.url).searchParams.get("projectId");
  if (!projectId) return validationResponse({ issues: [{ path: ["projectId"], message: "projectId is required" }] });
  try {
    return NextResponse.json({ data: { aliases: listEntityAliases(entityId, projectId) } });
  } catch (error) {
    return routeErrorResponse("GET", `/api/entities/${entityId}/aliases`, error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { entityId } = await context.params;
  const parsed = createEntityAliasInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationResponse(parsed.error);
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return validationResponse({ issues: [{ path: ["projectId"], message: "projectId is required" }] });
  try {
    const alias = createEntityAlias(entityId, parsed.data, projectId);
    return NextResponse.json({ data: { alias } }, { status: 201 });
  } catch (error) {
    return routeErrorResponse("POST", `/api/entities/${entityId}/aliases`, error);
  }
}
