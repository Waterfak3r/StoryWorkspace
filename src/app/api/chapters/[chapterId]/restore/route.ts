import { NextResponse } from "next/server";
import { restoreChapterInputSchema } from "@/domain/narrative";
import { getChapter, getChapterVersion, restoreChapterVersion } from "@/server/db/narrative";
import { notFoundResponse, readJson, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";

type ChapterRestoreRouteContext = {
  params: Promise<{ chapterId: string }>;
};

export async function POST(request: Request, context: ChapterRestoreRouteContext) {
  const body = await readJson(request);
  const parsed = restoreChapterInputSchema.safeParse(body);
  if (!parsed.success) {
    return validationResponse(parsed.error);
  }

  try {
    const { chapterId } = await context.params;
    if (!getChapter(chapterId)) {
      return notFoundResponse("Chapter not found");
    }
    if (!getChapterVersion(chapterId, parsed.data.versionId)) {
      return notFoundResponse("Chapter version not found");
    }
    const restored = restoreChapterVersion(chapterId, parsed.data.versionId, parsed.data.baseUpdatedAt);
    return restored ? NextResponse.json({ data: restored }) : notFoundResponse("Chapter not found");
  } catch (error) {
    return routeErrorResponse("POST", new URL(request.url).pathname, error);
  }
}
