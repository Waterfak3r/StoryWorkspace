import { NextResponse } from "next/server";
import { updateOutlineNodeInputSchema } from "@/domain/narrative";
import { deleteOutlineNode, updateOutlineNode } from "@/server/db/narrative";
import { notFoundResponse, readJson, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";

type OutlineNodeRouteContext = {
  params: Promise<{ nodeId: string }>;
};

export async function PATCH(request: Request, context: OutlineNodeRouteContext) {
  const body = await readJson(request);
  const parsed = updateOutlineNodeInputSchema.safeParse(body);
  if (!parsed.success) {
    return validationResponse(parsed.error);
  }

  try {
    const { nodeId } = await context.params;
    const node = updateOutlineNode(nodeId, parsed.data);
    return node ? NextResponse.json({ data: { node } }) : notFoundResponse("Outline node not found");
  } catch (error) {
    return routeErrorResponse("PATCH", new URL(request.url).pathname, error);
  }
}

export async function DELETE(request: Request, context: OutlineNodeRouteContext) {
  try {
    const { nodeId } = await context.params;
    const deleted = deleteOutlineNode(nodeId);
    return deleted ? NextResponse.json({ data: { deleted: true } }) : notFoundResponse("Outline node not found");
  } catch (error) {
    return routeErrorResponse("DELETE", new URL(request.url).pathname, error);
  }
}
