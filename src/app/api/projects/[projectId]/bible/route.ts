import { NextResponse } from "next/server";
import { createBibleEntryInputSchema } from "@/domain/narrative";
import { createBibleEntry } from "@/server/db/narrative";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";

type BibleRouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function POST(request: Request, context: BibleRouteContext) {
  const body = await readJson(request);
  const parsed = createBibleEntryInputSchema.safeParse(body);
  if (!parsed.success) {
    return validationResponse(parsed.error);
  }

  try {
    const { projectId } = await context.params;
    const entry = createBibleEntry(projectId, parsed.data);
    return NextResponse.json({ data: { entry } }, { status: 201 });
  } catch (error) {
    return routeErrorResponse("POST", new URL(request.url).pathname, error);
  }
}
