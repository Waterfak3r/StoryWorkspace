import { createSceneInputSchema } from "@/studio/domain";
import { createScene } from "@/studio/fs";
import { parseStudioBody, runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChapterScenesRouteContext = {
  params: Promise<{ projectId: string; volumeId: string; chapterId: string }>;
};

export async function POST(request: Request, context: ChapterScenesRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, volumeId, chapterId } = await context.params;
    const input = await parseStudioBody(request, createSceneInputSchema);
    const scene = createScene(projectId, volumeId, chapterId, input);
    return studioDataResponse({ scene }, 201);
  });
}
