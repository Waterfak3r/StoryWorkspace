import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { aiGenerateInputSchema } from "@/domain/ai";
import { createAiGeneration } from "@/server/db/narrative";
import { NarrativeNotFoundError, NarrativeValidationError } from "@/server/db/narrative-errors";
import { readJson, routeErrorResponse, validationResponse, aiProviderResponse } from "@/server/http";
import { resolveAiContext } from "@/server/ai/context";
import { buildAiPrompt } from "@/server/ai/prompt";
import { AiProviderError, generateAiMarkdown } from "@/server/ai/provider";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const path = new URL(request.url).pathname;
  const requestId = randomUUID();
  const body = await readJson(request);
  const parsed = aiGenerateInputSchema.safeParse(body);
  if (!parsed.success) {
    return validationResponse(parsed.error);
  }

  try {
    const input = parsed.data;
    const context = resolveAiContext(input.projectId, input.targetChapterId, input.context);
    const prompt = buildAiPrompt({
      action: input.action,
      instruction: input.instruction,
      selectedProse: input.selectedProse,
      context,
    });
    const generatedMarkdown = await generateAiMarkdown(prompt, {}, request.signal);
    if (request.signal.aborted) {
      throw new AiProviderError("AI_CANCELLED", "AI generation was cancelled.", 499, false);
    }
    const generation = createAiGeneration({
      projectId: input.projectId,
      targetChapterId: input.targetChapterId,
      action: input.action,
      instruction: input.instruction,
      contextReferenceIds: context.referenceIds,
      generatedMarkdown,
    });

    return NextResponse.json({ data: { generation, references: context.references } }, { status: 201 });
  } catch (error) {
    if (error instanceof AiProviderError) {
      if (error.code !== "AI_CANCELLED") {
        console.error("POST", path, { requestId, code: error.code, message: error.message });
      }
      return aiProviderResponse(error);
    }
    if (error instanceof NarrativeNotFoundError || error instanceof NarrativeValidationError) {
      return routeErrorResponse("POST", path, error);
    }
    console.error("POST", path, { requestId, code: "INTERNAL_ERROR" });
    return routeErrorResponse("POST", path, error);
  }
}
