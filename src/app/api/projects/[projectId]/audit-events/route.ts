import { NextResponse } from "next/server";
import { listAuditEvents } from "@/server/db/story-bible";
import { routeErrorResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  try {
    return NextResponse.json({ data: { events: listAuditEvents(projectId) } });
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/audit-events`, error);
  }
}
