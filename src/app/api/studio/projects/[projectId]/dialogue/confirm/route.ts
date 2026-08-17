import { z } from "zod";

import { confirmProjectDialogue } from "@/studio/dialogue";
import { parseStudioBody, runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const confirmProjectDialogueBodySchema = z.strictObject({});

type ProjectDialogueConfirmRouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function POST(request: Request, context: ProjectDialogueConfirmRouteContext) {
  return runStudioRoute(async () => {
    const { projectId } = await context.params;
    await parseStudioBody(request, confirmProjectDialogueBodySchema);
    const scenes = confirmProjectDialogue(projectId);
    return studioDataResponse({ scenes });
  });
}
