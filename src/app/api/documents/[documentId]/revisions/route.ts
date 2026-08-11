import { NextResponse } from "next/server";
import { createDocumentRevisionInputSchema } from "@/domain/document";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";
import { createDocumentRevision, listDocumentRevisions } from "@/server/db/document";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ documentId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { documentId } = await context.params;
  const projectId = new URL(_request.url).searchParams.get("projectId");
  if (!projectId) return validationResponse({ issues: [{ path: ["projectId"], message: "projectId is required" }] });
  try {
    return NextResponse.json({ data: { revisions: listDocumentRevisions(documentId, projectId) } });
  } catch (error) {
    return routeErrorResponse("GET", `/api/documents/${documentId}/revisions`, error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { documentId } = await context.params;
  const parsed = createDocumentRevisionInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationResponse(parsed.error);
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return validationResponse({ issues: [{ path: ["projectId"], message: "projectId is required" }] });
  try {
    listDocumentRevisions(documentId, projectId);
    const revision = createDocumentRevision(documentId, parsed.data);
    return NextResponse.json({ data: { revision } }, { status: 201 });
  } catch (error) {
    return routeErrorResponse("POST", `/api/documents/${documentId}/revisions`, error);
  }
}
