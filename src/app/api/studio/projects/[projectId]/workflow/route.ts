import { listWorkflowNodes } from "@/studio/generate";
import { runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WorkflowRouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function GET(_request: Request, context: WorkflowRouteContext) {
  return runStudioRoute(async () => {
    const { projectId } = await context.params;
    const nodes = listWorkflowNodes(projectId);
    return studioDataResponse({ nodes });
  });
}
