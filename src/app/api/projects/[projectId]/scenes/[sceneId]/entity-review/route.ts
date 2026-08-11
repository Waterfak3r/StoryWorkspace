import { NextResponse } from "next/server";
import { listAnalysisRuns } from "@/server/db/analysis";
import { listEntityMentions, listSceneEntityLinks } from "@/server/db/scene-link";
import { listAliasesByProject, listEntities, listEvidenceSources } from "@/server/db/story-bible";
import { getCurrentSceneRevision, getScene } from "@/server/db/document";
import { notFoundResponse, routeErrorResponse } from "@/server/http";

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
    const mentions = listEntityMentions(projectId, { sceneId, sceneRevisionId: selectedRevisionId });
    const links = listSceneEntityLinks(projectId, sceneId, { sceneRevisionId: selectedRevisionId });
    const entityIds = new Set([...mentions.flatMap((mention) => mention.entityId ? [mention.entityId] : []), ...links.map((link) => link.entityId)]);
    const entities = listEntities(projectId).filter((entity) => entityIds.has(entity.id));
    const aliases = listAliasesByProject(projectId).filter((alias) => entityIds.has(alias.entityId));
    const mentionIds = new Set(mentions.map((mention) => mention.evidenceSourceId));
    /* Evidence is a strict projection of the returned mentions. In
     * particular, an empty mention set must not expose every project source. */
    const evidenceSources = mentionIds.size === 0
      ? []
      : listEvidenceSources(projectId).filter((source) => mentionIds.has(source.id));
    const analysisRun = runs[0] ?? null;
    return NextResponse.json({ data: { review: { scene, analysisRun, runs, mentions, links, entities, aliases, evidenceSources }, scene, analysisRun, runs, mentions, links, entities, aliases, evidenceSources } });
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/scenes/${sceneId}/entity-review`, error);
  }
}
