import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AdaptationEditConflictError, AiGenerationAlreadyAcceptedError, AiGenerationAlreadyConsumedError, ChapterEditConflictError, NarrativeNotFoundError, NarrativeValidationError } from "@/server/db/narrative-errors";
import { AiProviderError } from "@/server/ai/provider";

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
