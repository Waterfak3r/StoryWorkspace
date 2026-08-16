export class StudioValidationError extends Error {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "StudioValidationError";
    this.field = field;
  }
}

export class StudioNotFoundError extends Error {
  constructor(message = "Not found.") {
    super(message);
    this.name = "StudioNotFoundError";
  }
}

export class StudioEditConflictError extends Error {
  readonly current: unknown;

  constructor(
    current: unknown,
    message = "The record changed on disk. Review the current version before saving again.",
  ) {
    super(message);
    this.name = "StudioEditConflictError";
    this.current = current;
  }
}

export class StudioIdConflictError extends Error {
  constructor(message = "An item with this id already exists.") {
    super(message);
    this.name = "StudioIdConflictError";
  }
}

export class StudioConflictError extends Error {
  constructor(message = "This parse run cannot be confirmed.") {
    super(message);
    this.name = "StudioConflictError";
  }
}

export class StudioAiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: string, message: string, status: number, retryable: boolean) {
    super(message);
    this.name = "StudioAiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}
