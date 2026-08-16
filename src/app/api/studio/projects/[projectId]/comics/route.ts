import { assembleComicsBook } from "@/studio/comics";
import { runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProjectComicsRouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, context: ProjectComicsRouteContext) {
  return runStudioRoute(async () => {
    const { projectId } = await context.params;
    const book = assembleComicsBook(projectId);
    return studioDataResponse({ book });
  });
}
