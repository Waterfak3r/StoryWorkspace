import { updateChapterInputSchema } from "@/studio/domain";
import { updateChapter } from "@/studio/fs";
import { parseStudioBody, runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChapterRouteContext = {
  params: Promise<{ projectId: string; volumeId: string; chapterId: string }>;
};

export async function PATCH(request: Request, context: ChapterRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, volumeId, chapterId } = await context.params;
    const input = await parseStudioBody(request, updateChapterInputSchema);
    const chapter = updateChapter(projectId, volumeId, chapterId, input);
    return studioDataResponse({ chapter });
  });
}
