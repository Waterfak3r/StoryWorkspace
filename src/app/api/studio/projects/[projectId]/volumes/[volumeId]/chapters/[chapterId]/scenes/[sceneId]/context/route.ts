import { resolveContext } from "@/studio/context";
import { StudioValidationError } from "@/studio/errors";
import { runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SceneContextRouteContext = {
  params: Promise<{
    projectId: string;
    volumeId: string;
    chapterId: string;
    sceneId: string;
  }>;
};

export async function GET(request: Request, context: SceneContextRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, volumeId, chapterId, sceneId } = await context.params;
    const shotId = new URL(request.url).searchParams.get("shotId");
    if (shotId == null || shotId === "") {
      throw new StudioValidationError("Shot id is required.", "shotId");
    }

    const snapshot = resolveContext({ projectId, volumeId, chapterId, sceneId, shotId });
    return studioDataResponse({ snapshot });
  });
}
