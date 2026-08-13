import { NextResponse } from "next/server";
import { retryGenerationJobInputSchema } from "@/domain/generation";
import { retryGenerationJob } from "@/server/db/generation";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";
import { z } from "zod";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ projectId: string; jobId: string }> };
const paramsSchema = z.object({ projectId: z.string().uuid(), jobId: z.string().uuid() }).strict();

export async function POST(request: Request, context: RouteContext) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) return validationResponse(parsedParams.error);
  const parsedBody = retryGenerationJobInputSchema.safeParse(await readJson(request));
  if (!parsedBody.success) return validationResponse(parsedBody.error);
  const { projectId, jobId } = parsedParams.data;
  try {
    const result = retryGenerationJob(projectId, jobId, parsedBody.data);
    return NextResponse.json({ data: result });
  } catch (error) {
    return routeErrorResponse("POST", `/api/projects/${projectId}/generation-jobs/${jobId}/retry`, error);
  }
}
