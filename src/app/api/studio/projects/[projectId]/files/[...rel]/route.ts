import fs from "node:fs";

import { resolveProjectStillFile } from "@/studio/generate/image-output";
import { runStudioRoute } from "@/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProjectFileRouteContext = {
  params: Promise<{ projectId: string; rel: string[] }>;
};

function contentTypeFor(relativePath: string): string {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  return "image/png";
}

export async function GET(_request: Request, context: ProjectFileRouteContext) {
  return runStudioRoute(async () => {
    const { projectId, rel } = await context.params;
    const relative = rel.join("/");
    const file = resolveProjectStillFile(projectId, relative);
    const bytes = fs.readFileSync(file);
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": contentTypeFor(relative),
        "cache-control": "no-store",
      },
    });
  });
}
