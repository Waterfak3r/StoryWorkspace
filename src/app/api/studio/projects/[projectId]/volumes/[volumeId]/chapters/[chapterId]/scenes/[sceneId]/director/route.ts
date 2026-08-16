import { z } from "zod";

import { directSceneAsync } from "@/studio/director";
import { parseStudioBody, runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const directSceneBodySchema = z.strictObject({});

type SceneDirectorRouteContext = {
  params: Promise<{
    projectId: string;
    volumeId: string;
    chapterId: string;
    sceneId: string;
  }>;
};

export async function POST(request: Request, context: SceneDirectorRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, volumeId, chapterId, sceneId } = await context.params;
    await parseStudioBody(request, directSceneBodySchema);
    const scene = await directSceneAsync(projectId, volumeId, chapterId, sceneId);
    return studioDataResponse({ scene });
  });
}
