import { NextResponse } from "next/server";
import { submitGenerationInputSchema } from "@/domain/generation";
import { submitGeneration } from "@/server/db/generation";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";
import { z } from "zod";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ projectId: string }> };
const paramsSchema = z.object({ projectId: z.string().uuid() }).strict();

export async function POST(request: Request, context: RouteContext) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) return validationResponse(parsedParams.error);
  const parsedBody = submitGenerationInputSchema.safeParse(await readJson(request));
  if (!parsedBody.success) return validationResponse(parsedBody.error);
  const { projectId } = parsedParams.data;
  try {
    const result = submitGeneration(projectId, parsedBody.data);
    return NextResponse.json({ data: result }, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    return routeErrorResponse("POST", `/api/projects/${projectId}/generations`, error);
  }
}
