import { completeEntityReference } from "@/studio/generate/complete-reference";
import { runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CompleteReferenceRouteContext = {
  params: Promise<{ projectId: string; entityId: string }>;
};

export async function POST(_request: Request, context: CompleteReferenceRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, entityId } = await context.params;
    const result = await completeEntityReference(projectId, entityId);
    return studioDataResponse(
      { entity: result.entity, relativePath: result.relativePath },
      201,
    );
  });
}
