import type { GenerationRecord } from "@/domain/generation";

export class GenerationConflictError extends Error {
  readonly current: GenerationRecord;

  constructor(current: GenerationRecord, message = "The generation job changed on the server. Review the current job before retrying.") {
    super(message);
    this.name = "GenerationConflictError";
    this.current = current;
  }
}
