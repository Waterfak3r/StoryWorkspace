import { NextResponse } from "next/server";
import { createEntityAliasInputSchema } from "@/domain/story-bible";
import { createEntityAliasForProject, listEntityAliases } from "@/server/db/story-bible";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string; entityId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { projectId, entityId } = await context.params;
  try {
    return NextResponse.json({ data: { aliases: listEntityAliases(entityId, projectId) } });
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/entities/${entityId}/aliases`, error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId, entityId } = await context.params;
  const parsed = createEntityAliasInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    const alias = createEntityAliasForProject(projectId, entityId, parsed.data);
    return NextResponse.json({ data: { alias } }, { status: 201 });
  } catch (error) {
    return routeErrorResponse("POST", `/api/projects/${projectId}/entities/${entityId}/aliases`, error);
  }
}
