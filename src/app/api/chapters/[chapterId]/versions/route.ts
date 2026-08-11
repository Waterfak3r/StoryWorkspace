import { NextResponse } from "next/server";
import { createManualChapterVersionInputSchema } from "@/domain/narrative";
import { createChapterVersion, getChapter, listChapterVersions } from "@/server/db/narrative";
import { notFoundResponse, readJson, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";

type ChapterVersionsRouteContext = {
  params: Promise<{ chapterId: string }>;
};

export async function GET(request: Request, context: ChapterVersionsRouteContext) {
  try {
    const { chapterId } = await context.params;
    if (!getChapter(chapterId)) {
      return notFoundResponse("Chapter not found");
    }
    return NextResponse.json({ data: { versions: listChapterVersions(chapterId) } });
  } catch (error) {
    return routeErrorResponse("GET", new URL(request.url).pathname, error);
  }
}

export async function POST(request: Request, context: ChapterVersionsRouteContext) {
  const body = await readJson(request);
  const parsed = createManualChapterVersionInputSchema.safeParse(body);
  if (!parsed.success) {
    return validationResponse(parsed.error);
  }

  try {
    const { chapterId } = await context.params;
    const version = createChapterVersion(chapterId, parsed.data);
    return version ? NextResponse.json({ data: { version } }, { status: 201 }) : notFoundResponse("Chapter not found");
  } catch (error) {
    return routeErrorResponse("POST", new URL(request.url).pathname, error);
  }
}
