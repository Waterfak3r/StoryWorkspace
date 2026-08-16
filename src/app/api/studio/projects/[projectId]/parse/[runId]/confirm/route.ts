import { confirmParseInputSchema, confirmParseRun } from "@/studio/parse";
import { parseStudioBody, runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConfirmParseRouteContext = {
  params: Promise<{ projectId: string; runId: string }>;
};

export async function POST(request: Request, context: ConfirmParseRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, runId } = await context.params;
    const input = await parseStudioBody(request, confirmParseInputSchema);
    const result = await confirmParseRun(projectId, runId, input);
    return studioDataResponse(result);
  });
}
