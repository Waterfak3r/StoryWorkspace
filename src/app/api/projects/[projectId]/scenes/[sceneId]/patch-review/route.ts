import { NextResponse } from "next/server";
import { listPatchApplications, listPatchFacts, listPatches } from "@/server/db/canon-patch";
import { getDocumentForProject, getSceneRevision } from "@/server/db/document";
import { listInferences, listModelRuns } from "@/server/db/canon-patch";
import { listEvidenceSources } from "@/server/db/story-bible";
import { routeErrorResponse, validationResponse } from "@/server/http";
import { SceneAnalysisStaleError } from "@/server/db/story-bible-errors";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string; sceneId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { projectId, sceneId } = await context.params;
  const sceneRevisionId = new URL(request.url).searchParams.get("sceneRevisionId");
  if (!sceneRevisionId) return validationResponse({ issues: [{ path: ["sceneRevisionId"], message: "sceneRevisionId is required" }] });
  try {
    const revision = getSceneRevision(sceneRevisionId, projectId);
    if (!revision || revision.sceneId !== sceneId) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Scene revision not found", retryable: false } }, { status: 404 });
    const document = getDocumentForProject(projectId, revision.documentId);
    if (document.currentRevisionId !== revision.documentRevisionId) throw new SceneAnalysisStaleError("Patch review belongs to an older scene revision");
    const patches = listPatches(projectId, { sceneRevisionId });
    const patchInferenceIds = new Set(patches.flatMap((patch) => patch.inferenceId ? [patch.inferenceId] : []));
    const patchModelRunIds = new Set(patches.flatMap((patch) => patch.modelRunId ? [patch.modelRunId] : []));
    const patchEvidenceIds = new Set(patches.flatMap((patch) => patch.evidenceSourceIds));
    const patchIds = new Set(patches.map((patch) => patch.id));
    const applications = listPatchApplications(projectId).filter((application) => patchIds.has(application.patchId));
    const factIds = new Set(patches.flatMap((patch) => patch.targetFactId ? [patch.targetFactId] : []).concat(applications.flatMap((application) => application.resultingFactId ? [application.resultingFactId] : [])));
    return NextResponse.json({ data: {
      patches,
      applications,
      facts: listPatchFacts(projectId).filter((fact) => factIds.has(fact.id)),
      inferences: listInferences(projectId).filter((inference) => patchInferenceIds.has(inference.id)),
      modelRuns: listModelRuns(projectId, { sourceRevisionId: sceneRevisionId }).filter((run) => patchModelRunIds.has(run.id)),
      evidenceSources: listEvidenceSources(projectId).filter((source) => patchEvidenceIds.has(source.id)),
    } });
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/scenes/${sceneId}/patch-review`, error);
  }
}
