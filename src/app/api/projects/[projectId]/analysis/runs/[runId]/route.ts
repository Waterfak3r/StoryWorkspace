import { NextResponse } from "next/server";
import { getAnalysisRun } from "@/server/db/analysis";
import { notFoundResponse, routeErrorResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string; runId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { projectId, runId } = await context.params;
  try {
    const run = getAnalysisRun(runId, projectId);
    return run ? NextResponse.json({ data: { run } }) : notFoundResponse("Analysis run not found");
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/analysis/runs/${runId}`, error);
  }
}
