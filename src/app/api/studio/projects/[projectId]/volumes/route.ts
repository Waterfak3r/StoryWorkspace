import { createVolumeInputSchema } from "@/studio/domain";
import { createVolume } from "@/studio/fs";
import { parseStudioBody, runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProjectVolumesRouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function POST(request: Request, context: ProjectVolumesRouteContext) {
  return runStudioRoute(async () => {
    const { projectId } = await context.params;
    const input = await parseStudioBody(request, createVolumeInputSchema);
    const volume = createVolume(projectId, input);
    return studioDataResponse({ volume }, 201);
  });
}
