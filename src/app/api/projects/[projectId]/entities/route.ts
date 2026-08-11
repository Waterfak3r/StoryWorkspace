import { NextResponse } from "next/server";
import { createEntityInputSchema } from "@/domain/story-bible";
import { createEntity, listEntities } from "@/server/db/story-bible";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  try {
    return NextResponse.json({ data: { entities: listEntities(projectId) } });
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/entities`, error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const parsed = createEntityInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    const entity = createEntity(projectId, parsed.data);
    return NextResponse.json({ data: { entity } }, { status: 201 });
  } catch (error) {
    return routeErrorResponse("POST", `/api/projects/${projectId}/entities`, error);
  }
}
