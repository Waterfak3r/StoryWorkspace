import { updateSceneInputSchema } from "@/studio/domain";
import { deleteScene, readScene, updateScene } from "@/studio/fs";
import { parseStudioBody, runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SceneRouteContext = {
  params: Promise<{
    projectId: string;
    volumeId: string;
    chapterId: string;
    sceneId: string;
  }>;
};

export async function GET(_request: Request, context: SceneRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, volumeId, chapterId, sceneId } = await context.params;
    const scene = readScene(projectId, volumeId, chapterId, sceneId);
    return studioDataResponse({ scene });
  });
}

export async function PATCH(request: Request, context: SceneRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, volumeId, chapterId, sceneId } = await context.params;
    const input = await parseStudioBody(request, updateSceneInputSchema);
    const scene = updateScene(projectId, volumeId, chapterId, sceneId, input);
    return studioDataResponse({ scene });
  });
}

export async function DELETE(_request: Request, context: SceneRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, volumeId, chapterId, sceneId } = await context.params;
    const result = deleteScene(projectId, volumeId, chapterId, sceneId);
    return studioDataResponse(result);
  });
}
