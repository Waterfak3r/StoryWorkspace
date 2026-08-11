import { NextResponse } from "next/server";
import { supersedeFactInputSchema } from "@/domain/story-bible";
import { getFact, supersedeFact } from "@/server/db/story-bible";
import { notFoundResponse, readJson, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ factId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { factId } = await context.params;
  const parsed = supersedeFactInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationResponse(parsed.error);
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return validationResponse({ issues: [{ path: ["projectId"], message: "projectId is required" }] });
  try {
    if (!getFact(factId, projectId)) return notFoundResponse("Fact not found");
    const fact = supersedeFact(factId, parsed.data);
    return fact ? NextResponse.json({ data: { fact } }, { status: 201 }) : notFoundResponse("Fact not found");
  } catch (error) {
    return routeErrorResponse("POST", `/api/facts/${factId}/supersede`, error);
  }
}
