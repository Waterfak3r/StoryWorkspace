import { createEntityInputSchema, entityKindSchema } from "@/studio/domain";
import { StudioValidationError } from "@/studio/errors";
import { createEntity, listEntities } from "@/studio/fs";
import { parseStudioBody, runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProjectEntitiesRouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(request: Request, context: ProjectEntitiesRouteContext) {
  return runStudioRoute(async () => {
    const { projectId } = await context.params;
    const kindParam = new URL(request.url).searchParams.get("kind");
    const kindResult = entityKindSchema.safeParse(kindParam);
    if (!kindResult.success) {
      throw new StudioValidationError(
        kindParam == null || kindParam === "" ? "Kind is required." : "Kind must be character or location.",
        "kind",
      );
    }

    const entities = listEntities(projectId, kindResult.data);
    return studioDataResponse({ entities });
  });
}

export async function POST(request: Request, context: ProjectEntitiesRouteContext) {
  return runStudioRoute(async () => {
    const { projectId } = await context.params;
    const input = await parseStudioBody(request, createEntityInputSchema);
    const entity = createEntity(projectId, input);
    return studioDataResponse({ entity }, 201);
  });
}
