import { NextResponse } from "next/server";
import { createContinuityGroupInputSchema } from "@/domain/scene-state";
import { createContinuityGroup, getDocumentForProject, listContinuityGroups } from "@/server/db/document";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string; documentId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { projectId, documentId } = await context.params;
  try {
    getDocumentForProject(projectId, documentId);
    return NextResponse.json({ data: { continuityGroups: listContinuityGroups(documentId, projectId) } });
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/documents/${documentId}/continuity-groups`, error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId, documentId } = await context.params;
  const parsed = createContinuityGroupInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    getDocumentForProject(projectId, documentId);
    const result = createContinuityGroup(projectId, documentId, parsed.data);
    return NextResponse.json({ data: { continuityGroup: result.continuityGroup } }, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    return routeErrorResponse("POST", `/api/projects/${projectId}/documents/${documentId}/continuity-groups`, error);
  }
}
