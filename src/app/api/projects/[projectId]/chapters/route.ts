import { NextResponse } from "next/server";
import { createChapterInputSchema } from "@/domain/narrative";
import { createChapter, listChapters } from "@/server/db/narrative";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";

type ChaptersRouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(request: Request, context: ChaptersRouteContext) {
  try {
    const { projectId } = await context.params;
    return NextResponse.json({ data: { chapters: listChapters(projectId) } });
  } catch (error) {
    return routeErrorResponse("GET", new URL(request.url).pathname, error);
  }
}

export async function POST(request: Request, context: ChaptersRouteContext) {
  const body = await readJson(request);
  const parsed = createChapterInputSchema.safeParse(body);
  if (!parsed.success) {
    return validationResponse(parsed.error);
  }

  try {
    const { projectId } = await context.params;
    const chapter = createChapter(projectId, parsed.data);
    return NextResponse.json({ data: { chapter } }, { status: 201 });
  } catch (error) {
    return routeErrorResponse("POST", new URL(request.url).pathname, error);
  }
}
