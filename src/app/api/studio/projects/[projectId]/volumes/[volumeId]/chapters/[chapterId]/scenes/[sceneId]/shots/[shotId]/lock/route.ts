import { lockShotInputSchema } from "@/studio/domain";
import { lockShot, unlockShot } from "@/studio/generate";
import { parseStudioBody, runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ShotLockRouteContext = {
  params: Promise<{
    projectId: string;
    volumeId: string;
    chapterId: string;
    sceneId: string;
    shotId: string;
  }>;
};

export async function POST(request: Request, context: ShotLockRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, volumeId, chapterId, sceneId, shotId } = await context.params;
    const input = await parseStudioBody(request, lockShotInputSchema);
    const result = input.locked
      ? lockShot(projectId, volumeId, chapterId, sceneId, shotId)
      : unlockShot(projectId, volumeId, chapterId, sceneId, shotId);
    return studioDataResponse({ shot: result.shot, node: result.node });
  });
}
