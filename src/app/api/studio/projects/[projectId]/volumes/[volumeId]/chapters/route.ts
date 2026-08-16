import { createChapterInputSchema } from "@/studio/domain";
import { createChapter } from "@/studio/fs";
import { parseStudioBody, runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VolumeChaptersRouteContext = {
  params: Promise<{ projectId: string; volumeId: string }>;
};

export async function POST(request: Request, context: VolumeChaptersRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, volumeId } = await context.params;
    const input = await parseStudioBody(request, createChapterInputSchema);
    const chapter = createChapter(projectId, volumeId, input);
    return studioDataResponse({ chapter }, 201);
  });
}
