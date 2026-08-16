import { listShots } from "@/studio/director";
import { runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SceneShotsRouteContext = {
  params: Promise<{
    projectId: string;
    volumeId: string;
    chapterId: string;
    sceneId: string;
  }>;
};

export async function GET(_request: Request, context: SceneShotsRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, volumeId, chapterId, sceneId } = await context.params;
    const shots = listShots(projectId, volumeId, chapterId, sceneId);
    return studioDataResponse({ shots });
  });
}
