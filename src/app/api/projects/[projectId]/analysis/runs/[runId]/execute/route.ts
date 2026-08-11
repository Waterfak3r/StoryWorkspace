import { NextResponse } from "next/server";
import { executeAnalysisInputSchema } from "@/domain/analysis";
import { executeAnalysisRun, getAnalysisRun } from "@/server/db/analysis";
import { readJson, routeErrorResponse, notFoundResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string; runId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { projectId, runId } = await context.params;
  const parsed = executeAnalysisInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    if (!getAnalysisRun(runId, projectId)) return notFoundResponse("Analysis run not found");
    const run = executeAnalysisRun(projectId, runId, parsed.data);
    return NextResponse.json({ data: { run } });
  } catch (error) {
    return routeErrorResponse("POST", `/api/projects/${projectId}/analysis/runs/${runId}/execute`, error);
  }
}
