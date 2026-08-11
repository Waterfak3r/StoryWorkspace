import { NextResponse } from "next/server";
import { getDocumentRevision } from "@/server/db/document";
import { notFoundResponse, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ documentId: string; revisionId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { documentId, revisionId } = await context.params;
  const projectId = new URL(_request.url).searchParams.get("projectId");
  if (!projectId) return validationResponse({ issues: [{ path: ["projectId"], message: "projectId is required" }] });
  try {
    const revision = getDocumentRevision(revisionId, projectId);
    return revision && revision.documentId === documentId ? NextResponse.json({ data: { revision } }) : notFoundResponse("Document revision not found");
  } catch (error) {
    return routeErrorResponse("GET", `/api/documents/${documentId}/revisions/${revisionId}`, error);
  }
}
