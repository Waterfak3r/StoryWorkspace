import { NextResponse } from "next/server";
import { createReferenceAssetInputSchema } from "@/domain/generation-compiler";
import { createReferenceAsset, listReferenceAssets } from "@/server/db/reference-assets";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";
import { z } from "zod";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ projectId: string }> };
const paramsSchema = z.object({ projectId: z.string().uuid() }).strict();
const querySchema = z.object({ entityId: z.string().uuid().optional() }).strict();

export async function GET(request: Request, context: RouteContext) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) return validationResponse(parsedParams.error);
  const parsedQuery = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsedQuery.success) return validationResponse(parsedQuery.error);
  const { projectId } = parsedParams.data;
  try {
    return NextResponse.json({ data: { referenceAssets: listReferenceAssets(projectId, parsedQuery.data) } });
  } catch (error) {
    return routeErrorResponse("GET", `/api/projects/${projectId}/reference-assets`, error);
  }
}
export async function POST(request: Request, context: RouteContext) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) return validationResponse(parsedParams.error);
  const parsedBody = createReferenceAssetInputSchema.safeParse(await readJson(request));
  if (!parsedBody.success) return validationResponse(parsedBody.error);
  const { projectId } = parsedParams.data;
  try {
    const result = createReferenceAsset(projectId, parsedBody.data);
    return NextResponse.json({ data: result }, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    return routeErrorResponse("POST", `/api/projects/${projectId}/reference-assets`, error);
  }
}
