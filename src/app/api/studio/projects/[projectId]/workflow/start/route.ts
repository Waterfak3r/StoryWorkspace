import { startWorkflow } from "@/studio/workflow";
import { runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type WorkflowStartRouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function POST(_request: Request, context: WorkflowStartRouteContext) {
  return runStudioRoute(async () => {
    const { projectId } = await context.params;
    const result = await startWorkflow(projectId);
    return studioDataResponse(result);
  });
}
