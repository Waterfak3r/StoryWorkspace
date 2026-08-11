import { NextResponse } from "next/server";
import { acceptEditedPatchInputSchema } from "@/domain/canon-patch";
import { acceptEditedPatch } from "@/server/db/canon-patch";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string; patchId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { projectId, patchId } = await context.params;
  const parsed = acceptEditedPatchInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    return NextResponse.json({ data: acceptEditedPatch(projectId, patchId, parsed.data) });
  } catch (error) {
    return routeErrorResponse("POST", `/api/projects/${projectId}/patches/${patchId}/accept-edited`, error);
  }
}
