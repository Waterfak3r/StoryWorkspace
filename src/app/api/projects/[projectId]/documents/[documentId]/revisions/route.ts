import { NextResponse } from "next/server";
import { createDocumentRevisionInputSchema } from "@/domain/document";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";
import { createDocumentRevision, getDocumentForProject, listDocumentRevisions } from "@/server/db/document";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ projectId: string; documentId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { projectId, documentId } = await context.params;
  try {
    getDocumentForProject(projectId, documentId);
    return NextResponse.json({ data: { revisions: listDocumentRevisions(documentId, projectId) } });
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/documents/${documentId}/revisions`, error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId, documentId } = await context.params;
  const parsed = createDocumentRevisionInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    getDocumentForProject(projectId, documentId);
    const revision = createDocumentRevision(documentId, parsed.data);
    return NextResponse.json({ data: { revision } }, { status: 201 });
  } catch (error) {
    return routeErrorResponse("POST", `/api/projects/${projectId}/documents/${documentId}/revisions`, error);
  }
}
