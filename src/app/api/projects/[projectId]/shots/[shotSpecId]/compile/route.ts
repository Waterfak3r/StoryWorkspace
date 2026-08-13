import { NextResponse } from "next/server";
import { compileShotInputSchema } from "@/domain/generation-compiler";
import { compileShot } from "@/server/db/generation-compiler";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";
import { z } from "zod";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ projectId: string; shotSpecId: string }> };
const paramsSchema = z.object({ projectId: z.string().uuid(), shotSpecId: z.string().uuid() }).strict();

export async function POST(request: Request, context: RouteContext) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) return validationResponse(parsedParams.error);
  const parsedBody = compileShotInputSchema.safeParse(await readJson(request));
  if (!parsedBody.success) return validationResponse(parsedBody.error);
  const { projectId, shotSpecId } = parsedParams.data;
  try {
    const result = compileShot(projectId, shotSpecId, parsedBody.data);
    return NextResponse.json({ data: result }, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    return routeErrorResponse("POST", `/api/projects/${projectId}/shots/${shotSpecId}/compile`, error);
  }
}
