import "server-only";

import { StudioAiError, StudioValidationError } from "../errors";
import { readProject } from "../fs";
import { normalizeLlmParseProposal } from "./normalize-proposal";
import { allocateParseRunId, nowIso, writeParseRun } from "./runs";
import {
  llmParseProposalSchema,
  type CompleteJson,
  type StudioParseRun,
} from "./schemas";

export async function parsePastedText(
  projectId: string,
  text: string,
  completeJson: CompleteJson,
): Promise<StudioParseRun> {
  readProject(projectId);

  const sourceText = typeof text === "string" ? text.trim() : "";
  if (!sourceText) {
    throw new StudioValidationError("Paste some text to parse.", "text");
  }

  const raw = await completeJson(
    llmParseProposalSchema,
    `Extract proposed scenes and entities from this story text.\n\n${sourceText}`,
  );

  const normalized = normalizeLlmParseProposal(raw);
  const parsed = llmParseProposalSchema.safeParse(normalized);
  if (!parsed.success) {
    console.error({
      code: "AI_INVALID_RESPONSE",
      issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    });
    throw new StudioAiError(
      "AI_INVALID_RESPONSE",
      "The AI provider returned an invalid parse result. Try again.",
      502,
      true,
    );
  }

  const now = nowIso();
  const run: StudioParseRun = {
    id: allocateParseRunId(projectId),
    status: "pending",
    sourceText,
    proposedScenes: parsed.data.proposedScenes,
    proposedEntities: parsed.data.proposedEntities,
    createdAt: now,
    updatedAt: now,
  };

  return writeParseRun(projectId, run);
}
