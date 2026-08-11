import { NextResponse } from "next/server";
import { updateChapterInputSchema } from "@/domain/narrative";
import { deleteChapter, getChapter, updateChapter } from "@/server/db/narrative";
import { editConflictResponse, notFoundResponse, readJson, routeErrorResponse, validationResponse } from "@/server/http";
import { ChapterEditConflictError } from "@/server/db/narrative-errors";

export const runtime = "nodejs";

type ChapterRouteContext = {
  params: Promise<{ chapterId: string }>;
};

export async function GET(request: Request, context: ChapterRouteContext) {
  try {
    const { chapterId } = await context.params;
    const chapter = getChapter(chapterId);
    return chapter ? NextResponse.json({ data: { chapter } }) : notFoundResponse("Chapter not found");
  } catch (error) {
    return routeErrorResponse("GET", new URL(request.url).pathname, error);
  }
}

export async function PATCH(request: Request, context: ChapterRouteContext) {
  const body = await readJson(request);
  const parsed = updateChapterInputSchema.safeParse(body);
  if (!parsed.success) {
    return validationResponse(parsed.error);
  }

  try {
    const { chapterId } = await context.params;
    const chapter = updateChapter(chapterId, parsed.data);
    return chapter ? NextResponse.json({ data: { chapter } }) : notFoundResponse("Chapter not found");
  } catch (error) {
    if (error instanceof ChapterEditConflictError) {
      return editConflictResponse(error.currentChapter, error.message);
    }
    return routeErrorResponse("PATCH", new URL(request.url).pathname, error);
  }
}

export async function DELETE(request: Request, context: ChapterRouteContext) {
  try {
    const { chapterId } = await context.params;
    const deleted = deleteChapter(chapterId);
    return deleted ? NextResponse.json({ data: { deleted: true } }) : notFoundResponse("Chapter not found");
  } catch (error) {
    return routeErrorResponse("DELETE", new URL(request.url).pathname, error);
  }
}
