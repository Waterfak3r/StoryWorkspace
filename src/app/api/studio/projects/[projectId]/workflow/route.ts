import { assembleProjectDialogue } from "@/studio/dialogue";
import { listWorkflowNodes } from "@/studio/generate";
import { runStudioRoute, studioDataResponse } from "@/studio/http";
import { assemblePipelineGraph } from "@/studio/workflow";

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
    return studioDataResponse({
      pipeline: assemblePipelineGraph(projectId),
      nodes: listWorkflowNodes(projectId),
      dialogue: assembleProjectDialogue(projectId),
    });
  });
}
