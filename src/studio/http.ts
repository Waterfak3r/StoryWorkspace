import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { ZodError } from "zod";

import {
  StudioAiError,
  StudioConflictError,
  StudioEditConflictError,
  StudioIdConflictError,
  StudioNotFoundError,
  StudioValidationError,
} from "./errors";

type ValidationIssue = {
  path: Array<string | number>;
  message: string;
};

type ValidationErrorLike = Pick<ZodError, "issues"> | { issues: ValidationIssue[] };

export function studioDataResponse(data: unknown, status = 200): NextResponse {
  return NextResponse.json({ data }, { status });
}

export function studioValidationResponse(error: ValidationErrorLike): NextResponse {
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

  return errorEnvelope(400, "VALIDATION_ERROR", rootErrors[0] ?? "Check the highlighted fields and try again.", {
    fieldErrors,
    retryable: false,
  });
}

export async function readStudioJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new StudioValidationError("Request body must be valid JSON.");
  }
}

export async function parseStudioBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const raw = await readStudioJson(request);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw parsed.error;
  }
  return parsed.data;
}

export async function runStudioRoute(action: () => Response | Promise<Response>): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    return handleStudioError(error);
  }
}

export function handleStudioError(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return studioValidationResponse(error);
  }

  if (error instanceof StudioValidationError) {
    return errorEnvelope(400, "VALIDATION_ERROR", error.message, {
      fieldErrors: error.field ? { [error.field]: [error.message] } : undefined,
      retryable: false,
    });
  }

  if (error instanceof StudioNotFoundError) {
    return errorEnvelope(404, "NOT_FOUND", error.message, { retryable: false });
  }

  if (error instanceof StudioEditConflictError) {
    // `current` is top-level so clients can show the disk record without a typed-resource key.
    return errorEnvelope(409, "EDIT_CONFLICT", error.message, {
      retryable: false,
      current: error.current,
    });
  }

  if (error instanceof StudioIdConflictError) {
    return errorEnvelope(409, "ID_CONFLICT", error.message, { retryable: false });
  }

  if (error instanceof StudioConflictError) {
    return errorEnvelope(409, "CONFLICT", error.message, { retryable: false });
  }

  if (error instanceof StudioAiError) {
    return errorEnvelope(error.status, error.code, error.message, { retryable: error.retryable });
  }

  console.error("Studio route error", error instanceof Error ? error.name : "unknown");
  return errorEnvelope(500, "INTERNAL_ERROR", "The workspace could not be reached. Try again in a moment.", {
    retryable: true,
  });
}

function errorEnvelope(
  status: number,
  code: string,
  message: string,
  options: {
    fieldErrors?: Record<string, string[]>;
    retryable: boolean;
    current?: unknown;
  },
): NextResponse {
  const error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string[]>;
    retryable: boolean;
  } = {
    code,
    message,
    retryable: options.retryable,
  };

  if (options.fieldErrors && Object.keys(options.fieldErrors).length > 0) {
    error.fieldErrors = options.fieldErrors;
  }

  const body: { error: typeof error; current?: unknown } = { error };
  if ("current" in options) {
    body.current = options.current;
  }

  return NextResponse.json(body, { status });
}
