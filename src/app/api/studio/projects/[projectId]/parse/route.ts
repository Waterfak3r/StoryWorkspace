import { completeJson, listParseRuns, parsePastedText, parseTextInputSchema } from "@/studio/parse";
import { parseStudioBody, runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProjectParseRouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, context: ProjectParseRouteContext) {
  return runStudioRoute(async () => {
    const { projectId } = await context.params;
    const runs = listParseRuns(projectId);
    return studioDataResponse({ runs });
  });
}

export async function POST(request: Request, context: ProjectParseRouteContext) {
  return runStudioRoute(async () => {
    const { projectId } = await context.params;
    const input = await parseStudioBody(request, parseTextInputSchema);
    const run = await parsePastedText(projectId, input.text, completeJson);
    return studioDataResponse({ run }, 201);
  });
}
