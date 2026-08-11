import { NextResponse } from "next/server";
import { createFactInputSchema, factStatusSchema, type FactStatus } from "@/domain/story-bible";
import { createFact, listFacts } from "@/server/db/story-bible";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const search = new URL(request.url).searchParams;
  const statusValue = search.get("status") ?? undefined;
  const status = statusValue && factStatusSchema.safeParse(statusValue).success ? statusValue as FactStatus : undefined;
  try {
    return NextResponse.json({ data: { facts: listFacts(projectId, { subjectEntityId: search.get("subjectEntityId") ?? undefined, predicate: search.get("predicate") ?? undefined, status }) } });
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/facts`, error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const parsed = createFactInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    const fact = createFact(projectId, parsed.data);
    return NextResponse.json({ data: { fact } }, { status: 201 });
  } catch (error) {
    return routeErrorResponse("POST", `/api/projects/${projectId}/facts`, error);
  }
}
