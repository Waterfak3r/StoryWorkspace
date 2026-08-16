import { getWorkspaceRoot, listProjects } from "@/studio/fs";
import { runStudioRoute, studioDataResponse } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return runStudioRoute(() => {
    return studioDataResponse({
      root: getWorkspaceRoot(),
      projects: listProjects(),
    });
  });
}
