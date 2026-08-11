import { NextResponse } from "next/server";
import { updateAdaptationInputSchema } from "@/domain/adaptation";
import { AdaptationEditConflictError } from "@/server/db/narrative-errors";
import { deleteAdaptation, getAdaptation, updateAdaptation } from "@/server/db/narrative";
import { adaptationEditConflictResponse, notFoundResponse, readJson, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";

type AdaptationRouteContext = {
  params: Promise<{ adaptationId: string }>;
};

export async function GET(request: Request, context: AdaptationRouteContext) {
  try {
    const { adaptationId } = await context.params;
    const adaptation = getAdaptation(adaptationId);
    return adaptation ? NextResponse.json({ data: { adaptation } }) : notFoundResponse("Adaptation not found");
  } catch (error) {
    return routeErrorResponse("GET", new URL(request.url).pathname, error);
  }
}

export async function PATCH(request: Request, context: AdaptationRouteContext) {
  const body = await readJson(request);
  const parsed = updateAdaptationInputSchema.safeParse(body);
  if (!parsed.success) {
    return validationResponse(parsed.error);
  }

  try {
    const { adaptationId } = await context.params;
    const adaptation = updateAdaptation(adaptationId, parsed.data);
    return adaptation ? NextResponse.json({ data: { adaptation } }) : notFoundResponse("Adaptation not found");
  } catch (error) {
    if (error instanceof AdaptationEditConflictError) {
      return adaptationEditConflictResponse(error.currentAdaptation, error.message);
    }
    return routeErrorResponse("PATCH", new URL(request.url).pathname, error);
  }
}

export async function DELETE(request: Request, context: AdaptationRouteContext) {
  try {
    const { adaptationId } = await context.params;
    const deleted = deleteAdaptation(adaptationId);
    return deleted ? NextResponse.json({ data: { deleted: true } }) : notFoundResponse("Adaptation not found");
  } catch (error) {
    return routeErrorResponse("DELETE", new URL(request.url).pathname, error);
  }
}
