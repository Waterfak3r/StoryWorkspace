import { NextResponse } from "next/server";
import { getEvidenceSource } from "@/server/db/story-bible";
import { notFoundResponse, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ sourceId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { sourceId } = await context.params;
  const projectId = new URL(_request.url).searchParams.get("projectId");
  if (!projectId) return validationResponse({ issues: [{ path: ["projectId"], message: "projectId is required" }] });
  try {
    const source = getEvidenceSource(sourceId, projectId);
    return source ? NextResponse.json({ data: { source } }) : notFoundResponse("Evidence source not found");
  } catch (error) {
    return routeErrorResponse("GET", `/api/evidence-sources/${sourceId}`, error);
  }
}
