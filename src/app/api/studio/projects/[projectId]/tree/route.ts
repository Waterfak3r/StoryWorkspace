import { readTree } from "@/studio/fs";
import { runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProjectTreeRouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, context: ProjectTreeRouteContext) {
  return runStudioRoute(async () => {
    const { projectId } = await context.params;
    const tree = readTree(projectId);
    return studioDataResponse({ volumes: tree.volumes });
  });
}
