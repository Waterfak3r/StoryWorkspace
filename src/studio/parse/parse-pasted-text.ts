import "server-only";

import { STUDIO_ENTITY_KINDS } from "../domain";
import { StudioAiError, StudioValidationError } from "../errors";
import { listEntities, readProject } from "../fs";
import { normalizeLlmParseProposal } from "./normalize-proposal";
import { preserveProposalScripts } from "./preserve-scripts";
import { ensureStoryStructure } from "./story-structure";
import { allocateParseRunId, nowIso, writeParseRun } from "./runs";
import {
  llmParseProposalSchema,
  type CompleteJson,
  type StudioParseRun,
} from "./schemas";

const EXTRACT_INSTRUCTIONS =
  "Extract proposed scenes and reusable entities from this complete story. Split the whole story into volumes, chapters, and scenes yourself — do not leave chapter division to the user. Give every scene a volumeName and a chapterName; group related beats in the same chapter and start a new chapter when the plot, place, or time shifts. Preserve transitions between distinct places and time periods as separate scenes. Copy each scene's original wording into script, including all dialogue; do not write a synopsis. Locations are kind location (environment). Clothing is kind costume. Entity description and look must be the FIRST stable appearance only — do not put later changes, injuries, deaths, or exchanged objects into the identity. Name recurring or consequential objects as props even if ownership changes. Put room layout into the location description (what is left/right/opposite the door).";

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

  const catalogEntities = STUDIO_ENTITY_KINDS.flatMap((kind) => listEntities(projectId, kind));
  const extractBlock = `${EXTRACT_INSTRUCTIONS}\n\n${sourceText}`;
  const prompt =
    catalogEntities.length > 0
      ? [
          "Existing reusable entities in this project. Reuse these exact names when the story refers to them. Clothing and wearable items are costumes (kind costume).",
          ...catalogEntities.map((entity) => `${entity.kind}: ${entity.name}`),
          "",
          extractBlock,
        ].join("\n")
      : extractBlock;

  const raw = await completeJson(llmParseProposalSchema, prompt);

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

  const preserved = preserveProposalScripts(sourceText, parsed.data);
  const structured = {
    proposedEntities: preserved.proposedEntities,
    proposedScenes: ensureStoryStructure(preserved.proposedScenes),
  };

  const now = nowIso();
  const run: StudioParseRun = {
    id: allocateParseRunId(projectId),
    status: "pending",
    sourceText,
    proposedScenes: structured.proposedScenes,
    proposedEntities: structured.proposedEntities,
    createdAt: now,
    updatedAt: now,
  };

  return writeParseRun(projectId, run);
}
