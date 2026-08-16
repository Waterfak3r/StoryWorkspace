import { updateEntityInputSchema } from "@/studio/domain";
import { readEntity, updateEntity } from "@/studio/fs";
import { parseStudioBody, runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EntityRouteContext = {
  params: Promise<{ projectId: string; entityId: string }>;
};

export async function GET(_request: Request, context: EntityRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, entityId } = await context.params;
    const entity = readEntity(projectId, entityId);
    return studioDataResponse({ entity });
  });
}

export async function PATCH(request: Request, context: EntityRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, entityId } = await context.params;
    const input = await parseStudioBody(request, updateEntityInputSchema);
    const entity = updateEntity(projectId, entityId, input);
    return studioDataResponse({ entity });
  });
}
