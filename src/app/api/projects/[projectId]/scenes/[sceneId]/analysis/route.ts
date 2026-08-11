import { NextResponse } from "next/server";
import { enqueueAnalysisInputSchema } from "@/domain/analysis";
import { listAnalysisRuns, enqueueAnalysisRun } from "@/server/db/analysis";
import { getCurrentSceneRevision, getScene } from "@/server/db/document";
import { listEntityMentions, listSceneEntityLinks } from "@/server/db/scene-link";
import { readJson, routeErrorResponse, notFoundResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string; sceneId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { projectId, sceneId } = await context.params;
  const sceneRevisionId = new URL(request.url).searchParams.get("sceneRevisionId") ?? undefined;
  try {
    const scene = getScene(sceneId, projectId);
    if (!scene) return notFoundResponse("Scene not found");
    const currentSceneRevision = getCurrentSceneRevision(sceneId, projectId);
    const selectedRevisionId = sceneRevisionId ?? currentSceneRevision?.id;
    const runs = selectedRevisionId ? listAnalysisRuns(projectId, { sceneId, sceneRevisionId: selectedRevisionId }) : [];
    return NextResponse.json({ data: { scene, runs, mentions: listEntityMentions(projectId, { sceneId, sceneRevisionId: selectedRevisionId }), links: listSceneEntityLinks(projectId, sceneId, { sceneRevisionId: selectedRevisionId }) } });
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/scenes/${sceneId}/analysis`, error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId, sceneId } = await context.params;
  const body = await readJson(request);
  const parsed = enqueueAnalysisInputSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);
  if (parsed.data.sceneId !== sceneId) return validationResponse({ issues: [{ path: ["sceneId"], message: "sceneId must match the route" }] });
  try {
    const result = enqueueAnalysisRun(projectId, parsed.data);
    return NextResponse.json({ data: { run: result.run, idempotent: result.idempotent } }, { status: result.idempotent ? 200 : 202 });
  } catch (error) {
    return routeErrorResponse("POST", `/api/projects/${projectId}/scenes/${sceneId}/analysis`, error);
  }
}
