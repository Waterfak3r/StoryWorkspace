import type { Chapter } from "@/domain/narrative";
import type { AiGeneration } from "@/domain/ai";
import type { Adaptation } from "@/domain/adaptation";

export type NarrativeValidationIssue = {
  path: Array<string | number>;
  message: string;
};

export class NarrativeValidationError extends Error {
  readonly issues: NarrativeValidationIssue[];

  constructor(message: string, path: Array<string | number> = []) {
    super(message);
    this.name = "NarrativeValidationError";
    this.issues = [{ path, message }];
  }
}

export class NarrativeNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NarrativeNotFoundError";
  }
}

export class NarrativeDataIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NarrativeDataIntegrityError";
  }
}

export class ChapterEditConflictError extends Error {
  readonly currentChapter: Chapter;

  constructor(currentChapter: Chapter) {
    super("The chapter changed on the server. Review the current text before saving again.");
    this.name = "ChapterEditConflictError";
    this.currentChapter = currentChapter;
  }
}

export class AdaptationEditConflictError extends Error {
  readonly currentAdaptation: Adaptation;

  constructor(currentAdaptation: Adaptation) {
    super("The adaptation changed on the server. Review the current draft before saving again.");
    this.name = "AdaptationEditConflictError";
    this.currentAdaptation = currentAdaptation;
  }
}

export class AiGenerationAlreadyAcceptedError extends Error {
  readonly generation: AiGeneration;

  constructor(generation: AiGeneration) {
    super("This AI generation has already been accepted");
    this.name = "AiGenerationAlreadyAcceptedError";
    this.generation = generation;
  }
}

export class AiGenerationAlreadyConsumedError extends Error {
  readonly generation: AiGeneration;
  readonly consumedBy: "chapter" | "adaptation";
  readonly currentAdaptation: Adaptation | null;

  constructor(generation: AiGeneration, consumedBy: "chapter" | "adaptation", currentAdaptation: Adaptation | null = null) {
    super("This AI generation has already been used.");
    this.name = "AiGenerationAlreadyConsumedError";
    this.generation = generation;
    this.consumedBy = consumedBy;
    this.currentAdaptation = currentAdaptation;
  }
}
