import { NextResponse } from "next/server";
import { PREDICATE_SCHEMA_REGISTRY } from "@/domain/story-bible";
import { listEntities } from "@/server/db/story-bible";
import { routeErrorResponse } from "@/server/http";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  try {
    listEntities(projectId);
    return NextResponse.json({ data: { predicates: PREDICATE_SCHEMA_REGISTRY } });
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/schema-registry`, error);
  }
}
