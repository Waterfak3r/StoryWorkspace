import { assembleStoryOutline } from "@/studio/outline";
import { runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProjectOutlineRouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, context: ProjectOutlineRouteContext) {
  return runStudioRoute(async () => {
    const { projectId } = await context.params;
    const outline = assembleStoryOutline(projectId);
    return studioDataResponse({ outline });
  });
}
