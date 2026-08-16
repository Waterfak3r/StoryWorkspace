import { updateVolumeInputSchema } from "@/studio/domain";
import { deleteVolume, updateVolume } from "@/studio/fs";
import { parseStudioBody, runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VolumeRouteContext = {
  params: Promise<{ projectId: string; volumeId: string }>;
};

export async function PATCH(request: Request, context: VolumeRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, volumeId } = await context.params;
    const input = await parseStudioBody(request, updateVolumeInputSchema);
    const volume = updateVolume(projectId, volumeId, input);
    return studioDataResponse({ volume });
  });
}

export async function DELETE(_request: Request, context: VolumeRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, volumeId } = await context.params;
    const result = deleteVolume(projectId, volumeId);
    return studioDataResponse(result);
  });
}
