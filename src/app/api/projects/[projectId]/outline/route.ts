import { NextResponse } from "next/server";
import { createOutlineNodeInputSchema } from "@/domain/narrative";
import { createOutlineNode } from "@/server/db/narrative";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";

type OutlineRouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function POST(request: Request, context: OutlineRouteContext) {
  const body = await readJson(request);
  const parsed = createOutlineNodeInputSchema.safeParse(body);
  if (!parsed.success) {
    return validationResponse(parsed.error);
  }

  try {
    const { projectId } = await context.params;
    const node = createOutlineNode(projectId, parsed.data);
    return NextResponse.json({ data: { node } }, { status: 201 });
  } catch (error) {
    return routeErrorResponse("POST", new URL(request.url).pathname, error);
  }
}
