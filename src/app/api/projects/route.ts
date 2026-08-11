import { NextResponse } from "next/server";
import { createProjectInputSchema } from "@/domain/project";
import { validationResponse, unavailableResponse, readJson } from "@/server/http";
import { createProject, listProjects } from "@/server/db/projects";

export const runtime = "nodejs";

export function GET(request: Request) {
  try {
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    return NextResponse.json({ data: { projects: listProjects({ includeArchived }) } });
  } catch (error) {
    console.error("GET /api/projects", new URL(request.url).pathname, error);
    return unavailableResponse();
  }
}

export async function POST(request: Request) {
  const body = await readJson(request);
  const parsed = createProjectInputSchema.safeParse(body);

  if (!parsed.success) {
    return validationResponse(parsed.error);
  }

  try {
    const project = createProject(parsed.data);
    return NextResponse.json({ data: { project } }, { status: 201 });
  } catch (error) {
    console.error("POST /api/projects", new URL(request.url).pathname, error);
    return unavailableResponse();
  }
}
