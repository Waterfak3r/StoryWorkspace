import { getNarrativeWorkspace } from "@/server/db/narrative";
import { projectExportContentDisposition, renderProjectMarkdown } from "@/server/export/markdown";
import { notFoundResponse, routeErrorResponse } from "@/server/http";

export const runtime = "nodejs";

type ExportRouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(request: Request, context: ExportRouteContext) {
  try {
    const { projectId } = await context.params;
    const workspace = getNarrativeWorkspace(projectId);
    if (!workspace) {
      return notFoundResponse("Project not found");
    }

    return new Response(renderProjectMarkdown(workspace), {
      status: 200,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": projectExportContentDisposition(workspace.project.title),
      },
    });
  } catch (error) {
    return routeErrorResponse("GET", new URL(request.url).pathname, error);
  }
}
