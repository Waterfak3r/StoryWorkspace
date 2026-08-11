import { NextResponse } from "next/server";
import { createScriptDocumentInputSchema } from "@/domain/document";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";
import { createDocument, listDocuments } from "@/server/db/document";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  try {
    return NextResponse.json({ data: { documents: listDocuments(projectId) } });
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/documents`, error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const parsed = createScriptDocumentInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    const document = createDocument(projectId, parsed.data);
    return NextResponse.json({ data: { document } }, { status: 201 });
  } catch (error) {
    return routeErrorResponse("POST", `/api/projects/${projectId}/documents`, error);
  }
}
