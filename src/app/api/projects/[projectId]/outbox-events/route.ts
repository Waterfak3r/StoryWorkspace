import { NextResponse } from "next/server";
import { listOutboxEvents } from "@/server/db/story-bible";
import { routeErrorResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  try {
    return NextResponse.json({ data: { events: listOutboxEvents(projectId) } });
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/outbox-events`, error);
  }
}
