import { NextResponse } from "next/server";
import { retractFactInputSchema } from "@/domain/story-bible";
import { getFact, retractFact } from "@/server/db/story-bible";
import { notFoundResponse, readJson, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ factId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { factId } = await context.params;
  const parsed = retractFactInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationResponse(parsed.error);
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return validationResponse({ issues: [{ path: ["projectId"], message: "projectId is required" }] });
  try {
    if (!getFact(factId, projectId)) return notFoundResponse("Fact not found");
    const fact = retractFact(factId, parsed.data);
    return fact ? NextResponse.json({ data: { fact } }) : notFoundResponse("Fact not found");
  } catch (error) {
    return routeErrorResponse("POST", `/api/facts/${factId}/retract`, error);
  }
}
