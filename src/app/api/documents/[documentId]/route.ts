import { NextResponse } from "next/server";
import { updateScriptDocumentInputSchema } from "@/domain/document";
import { readJson, routeErrorResponse, notFoundResponse, validationResponse } from "@/server/http";
import { getDocumentForProject, updateDocument } from "@/server/db/document";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ documentId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { documentId } = await context.params;
  const projectId = new URL(_request.url).searchParams.get("projectId");
  if (!projectId) return validationResponse({ issues: [{ path: ["projectId"], message: "projectId is required" }] });
  try {
    const document = getDocumentForProject(projectId, documentId);
    return document ? NextResponse.json({ data: { document } }) : notFoundResponse("Document not found");
  } catch (error) {
    return routeErrorResponse("GET", `/api/documents/${documentId}`, error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { documentId } = await context.params;
  const parsed = updateScriptDocumentInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationResponse(parsed.error);
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return validationResponse({ issues: [{ path: ["projectId"], message: "projectId is required" }] });
  try {
    getDocumentForProject(projectId, documentId);
    const document = updateDocument(documentId, parsed.data);
    return document ? NextResponse.json({ data: { document } }) : notFoundResponse("Document not found");
  } catch (error) {
    return routeErrorResponse("PATCH", `/api/documents/${documentId}`, error);
  }
}
