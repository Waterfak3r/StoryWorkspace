import { NextResponse } from "next/server";
import { createEvidenceSourceInputSchema } from "@/domain/story-bible";
import { createEvidenceSource, listEvidenceSources } from "@/server/db/story-bible";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  try {
    return NextResponse.json({ data: { evidenceSources: listEvidenceSources(projectId) } });
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/evidence-sources`, error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const parsed = createEvidenceSourceInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    const source = createEvidenceSource(projectId, parsed.data);
    return NextResponse.json({ data: { source } }, { status: 201 });
  } catch (error) {
    return routeErrorResponse("POST", `/api/projects/${projectId}/evidence-sources`, error);
  }
}
