import { NextResponse } from "next/server";
import { listScenes } from "@/server/db/document";
import { routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ documentId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { documentId } = await context.params;
  const projectId = new URL(_request.url).searchParams.get("projectId");
  if (!projectId) return validationResponse({ issues: [{ path: ["projectId"], message: "projectId is required" }] });
  try {
    return NextResponse.json({ data: { scenes: listScenes(documentId, projectId) } });
  } catch (error) {
    return routeErrorResponse("GET", `/api/documents/${documentId}/scenes`, error);
  }
}
