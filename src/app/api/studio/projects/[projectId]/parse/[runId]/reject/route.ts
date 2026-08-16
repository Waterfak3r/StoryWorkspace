import { rejectParseRun } from "@/studio/parse";
import { runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RejectParseRouteContext = {
  params: Promise<{ projectId: string; runId: string }>;
};

export async function POST(_request: Request, context: RejectParseRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, runId } = await context.params;
    const run = rejectParseRun(projectId, runId);
    return studioDataResponse({ run });
  });
}
