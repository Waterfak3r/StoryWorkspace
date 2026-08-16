import { updateShotInputSchema } from "@/studio/domain";
import { updateShot } from "@/studio/director";
import { parseStudioBody, runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SceneShotRouteContext = {
  params: Promise<{
    projectId: string;
    volumeId: string;
    chapterId: string;
    sceneId: string;
    shotId: string;
  }>;
};

export async function PATCH(request: Request, context: SceneShotRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, volumeId, chapterId, sceneId, shotId } = await context.params;
    const input = await parseStudioBody(request, updateShotInputSchema);
    const shot = updateShot(projectId, volumeId, chapterId, sceneId, shotId, input);
    return studioDataResponse({ shot });
  });
}
