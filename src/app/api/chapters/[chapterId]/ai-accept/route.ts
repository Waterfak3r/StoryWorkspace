import { NextResponse } from "next/server";
import { aiAcceptInputSchema } from "@/domain/ai";
import { acceptAiGeneration } from "@/server/db/narrative";
import { readJson, routeErrorResponse, validationResponse } from "@/server/http";

export const runtime = "nodejs";

type AiAcceptRouteContext = {
  params: Promise<{ chapterId: string }>;
};

export async function POST(request: Request, context: AiAcceptRouteContext) {
  const body = await readJson(request);
  const parsed = aiAcceptInputSchema.safeParse(body);
  if (!parsed.success) {
    return validationResponse(parsed.error);
  }

  try {
    const { chapterId } = await context.params;
    const result = acceptAiGeneration(chapterId, parsed.data);
    return NextResponse.json({ data: result });
  } catch (error) {
    return routeErrorResponse("POST", new URL(request.url).pathname, error);
  }
}
