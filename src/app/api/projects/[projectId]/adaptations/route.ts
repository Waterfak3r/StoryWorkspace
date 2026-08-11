import { NextResponse } from "next/server";
import { createAdaptationInputSchema } from "@/domain/adaptation";
import { createAdaptation, listAdaptations } from "@/server/db/narrative";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";

type AdaptationsRouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(request: Request, context: AdaptationsRouteContext) {
  try {
    const { projectId } = await context.params;
    return NextResponse.json({ data: { adaptations: listAdaptations(projectId) } });
  } catch (error) {
    return routeErrorResponse("GET", new URL(request.url).pathname, error);
  }
}

export async function POST(request: Request, context: AdaptationsRouteContext) {
  const body = await readJson(request);
  const parsed = createAdaptationInputSchema.safeParse(body);
  if (!parsed.success) {
    return validationResponse(parsed.error);
  }

  try {
    const { projectId } = await context.params;
    const adaptation = createAdaptation(projectId, parsed.data);
    return NextResponse.json({ data: { adaptation } }, { status: 201 });
  } catch (error) {
    return routeErrorResponse("POST", new URL(request.url).pathname, error);
  }
}
