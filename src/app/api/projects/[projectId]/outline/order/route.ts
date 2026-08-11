import { NextResponse } from "next/server";
import { outlineOrderInputSchema } from "@/domain/narrative";
import { reorderOutlineNodes } from "@/server/db/narrative";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";

type OutlineOrderRouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function PATCH(request: Request, context: OutlineOrderRouteContext) {
  const body = await readJson(request);
  const parsed = outlineOrderInputSchema.safeParse(body);
  if (!parsed.success) {
    return validationResponse(parsed.error);
  }

  try {
    const { projectId } = await context.params;
    const nodes = reorderOutlineNodes(projectId, parsed.data);
    return NextResponse.json({ data: { nodes } });
  } catch (error) {
    return routeErrorResponse("PATCH", new URL(request.url).pathname, error);
  }
}
