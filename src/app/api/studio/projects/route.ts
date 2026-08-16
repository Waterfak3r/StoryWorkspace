import { createProjectInputSchema } from "@/studio/domain";
import { createProject } from "@/studio/fs";
import { parseStudioBody, runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return runStudioRoute(async () => {
    const input = await parseStudioBody(request, createProjectInputSchema);
    const project = createProject(input);
    return studioDataResponse({ project }, 201);
  });
}
