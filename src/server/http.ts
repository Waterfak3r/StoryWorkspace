import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AdaptationEditConflictError, AiGenerationAlreadyAcceptedError, AiGenerationAlreadyConsumedError, ChapterEditConflictError, NarrativeNotFoundError, NarrativeValidationError } from "@/server/db/narrative-errors";
import { AiProviderError } from "@/server/ai/provider";
import { SceneAnalysisStaleError, SceneEntityLinkConflictError, StoryBibleConflictError, StoryBibleIdempotencyConflictError, StoryBibleNotFoundError, StoryBiblePatchConflictError, StoryBiblePatchResolvedError, StoryBibleValidationError } from "@/server/db/story-bible-errors";

type ValidationIssue = {
  path: Array<string | number>;
  message: string;
};

type ValidationErrorLike = Pick<ZodError, "issues"> | { issues: ValidationIssue[] };

export function validationResponse(error: ValidationErrorLike) {
  const fieldErrors: Record<string, string[]> = {};
  const rootErrors: string[] = [];

  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string") {
      fieldErrors[field] ??= [];
      fieldErrors[field].push(issue.message);
    } else {
      rootErrors.push(issue.message);
    }
  }

  if (rootErrors.length > 0) {
    fieldErrors._form = rootErrors;
  }

  return NextResponse.json(
    {
      error: {
        code: "VALIDATION_ERROR",
        message: rootErrors[0] ?? "Check the highlighted fields and try again.",
        fieldErrors,
        retryable: false,
      },
    },
    { status: 400 },
  );
}

export function notFoundResponse(message = "Project not found") {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message, retryable: false } },
    { status: 404 },
  );
}

export function unavailableResponse() {
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The workspace could not be reached. Try again in a moment.",
        retryable: true,
      },
    },
    { status: 500 },
  );
}

export function editConflictResponse(currentChapter: unknown, message = "The chapter changed on the server. Review the current text before saving again.") {
  return NextResponse.json(
    {
      error: {
        code: "EDIT_CONFLICT",
        message,
        currentChapter,
        retryable: false,
      },
    },
    { status: 409 },
  );
}

export function adaptationEditConflictResponse(currentAdaptation: unknown, message = "The adaptation changed on the server. Review the current draft before saving again.") {
  return NextResponse.json(
    {
      error: {
        code: "EDIT_CONFLICT",
        message,
        currentAdaptation,
        retryable: false,
      },
    },
    { status: 409 },
  );
}

export function storyBibleConflictResponse(resourceType: "document" | "revision" | "entity" | "fact" | "storyboard", current: unknown, message = "The resource changed on the server. Review the current version before saving again.") {
  const key = resourceType === "document" ? "currentDocument" : resourceType === "entity" ? "currentEntity" : resourceType === "fact" ? "currentFact" : resourceType === "storyboard" ? "currentStoryboard" : "currentRevision";
  return NextResponse.json({ error: { code: "EDIT_CONFLICT", message, [key]: current, retryable: false } }, { status: 409 });
}

export function idempotencyConflictResponse(message = "This request ID was already used for a different operation") {
  return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message, retryable: false } }, { status: 409 });
}

export function sceneEntityLinkConflictResponse(currentLink: unknown, message = "The scene link changed on the server. Review the current candidate before trying again.") {
  return NextResponse.json({ error: { code: "EDIT_CONFLICT", message, currentLink, retryable: false } }, { status: 409 });
}

export function analysisStaleResponse(message = "The analysis belongs to an older scene revision. Enqueue the current revision again.") {
  return NextResponse.json({ error: { code: "ANALYSIS_STALE", message, retryable: false } }, { status: 409 });
}

export function storyBiblePatchConflictResponse(patch: unknown, message: string) {
  return NextResponse.json({ error: { code: "PATCH_CONFLICT", message, patch, currentPatch: patch, retryable: false } }, { status: 409 });
}

export function storyBiblePatchResolvedResponse(patch: unknown, message: string) {
  return NextResponse.json({ error: { code: "PATCH_RESOLVED", message, patch, retryable: false } }, { status: 409 });
}

export function aiGenerationAlreadyAcceptedResponse(message = "This AI draft has already been accepted.") {
  return NextResponse.json(
    {
      error: {
        code: "AI_GENERATION_ALREADY_ACCEPTED",
        message,
        retryable: false,
      },
    },
    { status: 409 },
  );
}

export function aiGenerationAlreadyConsumedResponse(
  consumedBy: "chapter" | "adaptation",
  currentAdaptation: unknown,
  message = "This AI generation has already been used.",
) {
  return NextResponse.json(
    {
      error: {
        code: "AI_GENERATION_ALREADY_CONSUMED",
        message,
        retryable: false,
        consumedBy,
        ...(consumedBy === "adaptation" && currentAdaptation !== null ? { currentAdaptation } : {}),
      },
    },
    { status: 409 },
  );
}

export function aiProviderResponse(error: AiProviderError) {
  return NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
    },
    { status: error.status },
  );
}

export function routeErrorResponse(method: string, path: string, error: unknown) {
  if (error instanceof NarrativeNotFoundError) {
    return notFoundResponse(error.message);
  }
  if (error instanceof NarrativeValidationError) {
    return validationResponse(error);
  }
  if (error instanceof ChapterEditConflictError) {
    return editConflictResponse(error.currentChapter, error.message);
  }
  if (error instanceof AdaptationEditConflictError) {
    return adaptationEditConflictResponse(error.currentAdaptation, error.message);
  }
  if (error instanceof AiGenerationAlreadyAcceptedError) {
    return aiGenerationAlreadyAcceptedResponse();
  }
  if (error instanceof AiGenerationAlreadyConsumedError) {
    return aiGenerationAlreadyConsumedResponse(error.consumedBy, error.currentAdaptation);
  }
  if (error instanceof StoryBibleNotFoundError) {
    return notFoundResponse(error.message);
  }
  if (error instanceof StoryBibleValidationError) {
    return validationResponse(error);
  }
  if (error instanceof StoryBibleConflictError) {
    return storyBibleConflictResponse(error.resourceType, error.current, error.message);
  }
  if (error instanceof StoryBibleIdempotencyConflictError) {
    return idempotencyConflictResponse(error.message);
  }
  if (error instanceof SceneEntityLinkConflictError) {
    return sceneEntityLinkConflictResponse(error.current, error.message);
  }
  if (error instanceof SceneAnalysisStaleError) {
    return analysisStaleResponse(error.message);
  }
  if (error instanceof StoryBiblePatchConflictError) {
    return storyBiblePatchConflictResponse(error.patch, error.reason);
  }
  if (error instanceof StoryBiblePatchResolvedError) {
    return storyBiblePatchResolvedResponse(error.patch, error.message);
  }

  console.error(`${method} ${path}`, error);
  return unavailableResponse();
}

export async function readJson(request: Request) {
  const text = await request.text();
  if (text.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
