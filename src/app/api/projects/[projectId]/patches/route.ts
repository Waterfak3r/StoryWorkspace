import { NextResponse } from "next/server";
import { patchStatusSchema } from "@/domain/canon-patch";
import { listPatches } from "@/server/db/canon-patch";
import { routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const search = new URL(request.url).searchParams;
  const statusValue = search.get("status") ?? undefined;
  if (statusValue && !patchStatusSchema.safeParse(statusValue).success) return validationResponse({ issues: [{ path: ["status"], message: "status is invalid" }] });
  const status = statusValue as typeof patchStatusSchema._output | undefined;
  try {
    return NextResponse.json({ data: { patches: listPatches(projectId, { status, sceneRevisionId: search.get("sceneRevisionId") ?? undefined, targetEntityId: search.get("targetEntityId") ?? undefined }) } });
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/patches`, error);
  }
}
