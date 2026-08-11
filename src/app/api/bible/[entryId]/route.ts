import { NextResponse } from "next/server";
import { updateBibleEntryInputSchema } from "@/domain/narrative";
import { deleteBibleEntry, updateBibleEntry } from "@/server/db/narrative";
import { notFoundResponse, readJson, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";

type BibleEntryRouteContext = {
  params: Promise<{ entryId: string }>;
};

export async function PATCH(request: Request, context: BibleEntryRouteContext) {
  const body = await readJson(request);
  const parsed = updateBibleEntryInputSchema.safeParse(body);
  if (!parsed.success) {
    return validationResponse(parsed.error);
  }

  try {
    const { entryId } = await context.params;
    const entry = updateBibleEntry(entryId, parsed.data);
    return entry ? NextResponse.json({ data: { entry } }) : notFoundResponse("Bible entry not found");
  } catch (error) {
    return routeErrorResponse("PATCH", new URL(request.url).pathname, error);
  }
}

export async function DELETE(request: Request, context: BibleEntryRouteContext) {
  try {
    const { entryId } = await context.params;
    const deleted = deleteBibleEntry(entryId);
    return deleted ? NextResponse.json({ data: { deleted: true } }) : notFoundResponse("Bible entry not found");
  } catch (error) {
    return routeErrorResponse("DELETE", new URL(request.url).pathname, error);
  }
}
