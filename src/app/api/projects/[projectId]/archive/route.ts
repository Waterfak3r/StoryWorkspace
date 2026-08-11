import { NextResponse } from "next/server";
import { notFoundResponse, unavailableResponse } from "@/server/http";
import { archiveProject } from "@/server/db/projects";

export const runtime = "nodejs";

type ArchiveRouteContext = {
  params: Promise<{ projectId: string }>;
};

// Kept as a compatibility alias. The library uses PATCH on the project resource,
// which is the canonical archival operation described in the API contract.
export async function POST(request: Request, context: ArchiveRouteContext) {
  try {
    const { projectId } = await context.params;
    const project = archiveProject(projectId);
    return project ? NextResponse.json({ data: { project } }) : notFoundResponse();
  } catch (error) {
    console.error("POST /api/projects/[projectId]/archive", new URL(request.url).pathname, error);
    return unavailableResponse();
  }
}
