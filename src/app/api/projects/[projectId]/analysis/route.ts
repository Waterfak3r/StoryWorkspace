import { NextResponse } from "next/server";
import { enqueueAnalysisInputSchema } from "@/domain/analysis";
import { listAnalysisRuns, enqueueAnalysisRun } from "@/server/db/analysis";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const search = new URL(request.url).searchParams;
  try {
    return NextResponse.json({ data: { runs: listAnalysisRuns(projectId, { sceneId: search.get("sceneId") ?? undefined, sceneRevisionId: search.get("sceneRevisionId") ?? undefined, status: (search.get("status") as "queued" | "running" | "succeeded" | "failed" | "stale" | null) ?? undefined }) } });
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/analysis`, error);
  }
}
export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const parsed = enqueueAnalysisInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    const result = enqueueAnalysisRun(projectId, parsed.data);
    return NextResponse.json({ data: { run: result.run, idempotent: result.idempotent } }, { status: result.idempotent ? 200 : 202 });
  } catch (error) {
    return routeErrorResponse("POST", `/api/projects/${projectId}/analysis`, error);
  }
}
