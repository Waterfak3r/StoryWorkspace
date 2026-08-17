import { z } from "zod";

import { confirmSceneDialogue } from "@/studio/dialogue";
import { parseStudioBody, runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const confirmSceneDialogueBodySchema = z.strictObject({});

type SceneDialogueConfirmRouteContext = {
  params: Promise<{
    projectId: string;
    volumeId: string;
    chapterId: string;
    sceneId: string;
  }>;
};

export async function POST(request: Request, context: SceneDialogueConfirmRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, volumeId, chapterId, sceneId } = await context.params;
    await parseStudioBody(request, confirmSceneDialogueBodySchema);
    const scene = confirmSceneDialogue(projectId, volumeId, chapterId, sceneId);
    return studioDataResponse({ scene });
  });
}
