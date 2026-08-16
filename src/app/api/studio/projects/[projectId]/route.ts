import { updateProjectInputSchema } from "@/studio/domain";
import { readProject, updateProject } from "@/studio/fs";
import { parseStudioBody, runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProjectRouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, context: ProjectRouteContext) {
  return runStudioRoute(async () => {
    const { projectId } = await context.params;
    const project = readProject(projectId);
    return studioDataResponse({ project });
  });
}

export async function PATCH(request: Request, context: ProjectRouteContext) {
  return runStudioRoute(async () => {
    const { projectId } = await context.params;
    const input = await parseStudioBody(request, updateProjectInputSchema);
    const project = updateProject(projectId, input);
    return studioDataResponse({ project });
  });
}
