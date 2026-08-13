import { NextResponse } from "next/server";
import { buildContextInputSchema } from "@/domain/context-builder";
import { buildContextSnapshot } from "@/server/db/context-builder";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";
import { z } from "zod";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string }> };
const projectIdSchema = z.string().uuid();

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const project = projectIdSchema.safeParse(projectId);
  if (!project.success) return validationResponse(project.error);
  const parsed = buildContextInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    const result = buildContextSnapshot(project.data, parsed.data);
    return NextResponse.json({ data: result }, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    return routeErrorResponse("POST", `/api/projects/${projectId}/contexts/build`, error);
  }
}
