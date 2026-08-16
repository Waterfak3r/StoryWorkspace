import { readParseRun } from "@/studio/parse";
import { runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParseRunRouteContext = {
  params: Promise<{ projectId: string; runId: string }>;
};

export async function GET(_request: Request, context: ParseRunRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, runId } = await context.params;
    const run = readParseRun(projectId, runId);
    return studioDataResponse({ run });
  });
}
