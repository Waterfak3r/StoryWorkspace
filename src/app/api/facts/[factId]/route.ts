import { NextResponse } from "next/server";
import { getFact } from "@/server/db/story-bible";
import { notFoundResponse, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ factId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { factId } = await context.params;
  const projectId = new URL(_request.url).searchParams.get("projectId");
  if (!projectId) return validationResponse({ issues: [{ path: ["projectId"], message: "projectId is required" }] });
  try {
    const fact = getFact(factId, projectId);
    return fact ? NextResponse.json({ data: { fact } }) : notFoundResponse("Fact not found");
  } catch (error) {
    return routeErrorResponse("GET", `/api/facts/${factId}`, error);
  }
}
