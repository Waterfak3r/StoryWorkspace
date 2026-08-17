import { updateContentStateInputSchema } from "@/studio/domain";
import { readContentState, readScene, writeContentState } from "@/studio/fs";
import { parseStudioBody, runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SceneStateRouteContext = {
  params: Promise<{
    projectId: string;
    volumeId: string;
    chapterId: string;
    sceneId: string;
  }>;
};

export async function GET(_request: Request, context: SceneStateRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, volumeId, chapterId, sceneId } = await context.params;
    readScene(projectId, volumeId, chapterId, sceneId);
    const stored = readContentState(projectId, volumeId, chapterId, sceneId);
    return studioDataResponse({
      state: stored ?? { volumeId, chapterId, sceneId, patches: [] },
    });
  });
}

export async function PUT(request: Request, context: SceneStateRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, volumeId, chapterId, sceneId } = await context.params;
    readScene(projectId, volumeId, chapterId, sceneId);
    const input = await parseStudioBody(request, updateContentStateInputSchema);
    const state = writeContentState(projectId, volumeId, chapterId, sceneId, input);
    return studioDataResponse({ state });
  });
}
