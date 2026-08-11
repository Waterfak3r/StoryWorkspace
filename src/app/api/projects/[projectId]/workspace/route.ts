import { NextResponse } from "next/server";
import { getNarrativeWorkspace } from "@/server/db/narrative";
import { notFoundResponse, routeErrorResponse } from "@/server/http";

export const runtime = "nodejs";

type WorkspaceRouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(request: Request, context: WorkspaceRouteContext) {
  try {
    const { projectId } = await context.params;
    const workspace = getNarrativeWorkspace(projectId);
    return workspace ? NextResponse.json({ data: workspace }) : notFoundResponse("Project not found");
  } catch (error) {
    return routeErrorResponse("GET", new URL(request.url).pathname, error);
  }
}
