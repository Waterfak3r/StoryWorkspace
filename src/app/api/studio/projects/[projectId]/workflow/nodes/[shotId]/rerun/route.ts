import { z } from "zod";

import { rerunUnlockedShot } from "@/studio/generate";
import { parseStudioBody, runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rerunBodySchema = z.strictObject({});

type WorkflowRerunRouteContext = {
  params: Promise<{
    projectId: string;
    shotId: string;
  }>;
};

export async function POST(request: Request, context: WorkflowRerunRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, shotId } = await context.params;
    await parseStudioBody(request, rerunBodySchema);
    const result = await rerunUnlockedShot(projectId, shotId);
    return studioDataResponse({
      shot: result.shot,
      node: result.node,
      continuityConstraints: result.continuityConstraints,
    });
  });
}
