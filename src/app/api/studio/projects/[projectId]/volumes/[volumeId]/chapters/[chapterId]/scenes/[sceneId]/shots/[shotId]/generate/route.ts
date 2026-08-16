import { generateShotInputSchema } from "@/studio/domain";
import { generateShot } from "@/studio/generate";
import { parseStudioBody, runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ShotGenerateRouteContext = {
  params: Promise<{
    projectId: string;
    volumeId: string;
    chapterId: string;
    sceneId: string;
    shotId: string;
  }>;
};

export async function POST(request: Request, context: ShotGenerateRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, volumeId, chapterId, sceneId, shotId } = await context.params;
    const input = await parseStudioBody(request, generateShotInputSchema);
    const result = await generateShot(projectId, volumeId, chapterId, sceneId, shotId, input);
    return studioDataResponse({
      shot: result.shot,
      node: result.node,
      continuityConstraints: result.continuityConstraints,
    });
  });
}
