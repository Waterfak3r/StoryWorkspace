import { NextResponse } from "next/server";
import { getPatch, listPatchApplications, listPatchFacts, listPatchStates } from "@/server/db/canon-patch";
import { notFoundResponse, routeErrorResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string; patchId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { projectId, patchId } = await context.params;
  try {
    const patch = getPatch(patchId, projectId);
    return patch ? NextResponse.json({ data: { patch, applications: listPatchApplications(projectId, patchId), facts: listPatchFacts(projectId, patchId), states: listPatchStates(projectId, patchId) } }) : notFoundResponse("Patch not found");
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/patches/${patchId}`, error);
  }
}
