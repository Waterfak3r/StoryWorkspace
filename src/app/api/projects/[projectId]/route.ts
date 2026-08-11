import { NextResponse } from "next/server";
import { updateProjectInputSchema } from "@/domain/project";
import { readJson, notFoundResponse, unavailableResponse, validationResponse } from "@/server/http";
import { getProjectById, updateProject } from "@/server/db/projects";

export const runtime = "nodejs";

type ProjectRouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(request: Request, context: ProjectRouteContext) {
  try {
    const { projectId } = await context.params;
    const project = getProjectById(projectId);
    return project ? NextResponse.json({ data: { project } }) : notFoundResponse();
  } catch (error) {
    console.error("GET /api/projects/[projectId]", new URL(request.url).pathname, error);
    return unavailableResponse();
  }
}

export async function PATCH(request: Request, context: ProjectRouteContext) {
  const body = await readJson(request);
  const parsed = updateProjectInputSchema.safeParse(body);

  if (!parsed.success) {
    return validationResponse(parsed.error);
  }

  try {
    const { projectId } = await context.params;
    const project = updateProject(projectId, parsed.data);
    return project ? NextResponse.json({ data: { project } }) : notFoundResponse();
  } catch (error) {
    console.error("PATCH /api/projects/[projectId]", new URL(request.url).pathname, error);
    return unavailableResponse();
  }
}
