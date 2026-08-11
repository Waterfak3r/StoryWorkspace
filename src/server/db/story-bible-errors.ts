import type { DocumentRevision, SceneRevision, ScriptDocument } from "@/domain/document";
import type { Entity, Fact } from "@/domain/story-bible";
import type { Patch } from "@/domain/canon-patch";
import type { SceneEntityLink } from "@/domain/scene-link";

export type StoryBibleValidationIssue = {
  path: Array<string | number>;
  message: string;
};

export class StoryBibleValidationError extends Error {
  readonly issues: StoryBibleValidationIssue[];

  constructor(message: string, path: Array<string | number> = []) {
    super(message);
    this.name = "StoryBibleValidationError";
    this.issues = [{ path, message }];
  }
}

export class StoryBibleNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoryBibleNotFoundError";
  }
}

export class StoryBibleDataIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoryBibleDataIntegrityError";
  }
}

export class StoryBibleConflictError extends Error {
  readonly resourceType: "document" | "revision" | "entity" | "fact";
  readonly current: ScriptDocument | DocumentRevision | SceneRevision | Entity | Fact;

  constructor(resourceType: "document" | "revision" | "entity" | "fact", current: ScriptDocument | DocumentRevision | SceneRevision | Entity | Fact) {
    super(`The ${resourceType} changed on the server. Review the current version before saving again.`);
    this.name = "StoryBibleConflictError";
    this.resourceType = resourceType;
    this.current = current;
  }
}

export class StoryBibleIdempotencyConflictError extends Error {
  constructor(message = "This request ID was already used for a different operation") {
    super(message);
    this.name = "StoryBibleIdempotencyConflictError";
  }
}

export class SceneEntityLinkConflictError extends Error {
  readonly current: SceneEntityLink;

  constructor(current: SceneEntityLink, message = "The scene link changed on the server. Review the current candidate before trying again.") {
    super(message);
    this.name = "SceneEntityLinkConflictError";
    this.current = current;
  }
}

export class SceneAnalysisStaleError extends Error {
  constructor(message = "Analysis belongs to an older scene revision") {
    super(message);
    this.name = "SceneAnalysisStaleError";
  }
}

export class StoryBiblePatchConflictError extends Error {
  readonly patch: Patch;
  readonly reason: string;

  constructor(patch: Patch, reason: string) {
    super(reason);
    this.name = "StoryBiblePatchConflictError";
    this.patch = patch;
    this.reason = reason;
  }
}

export class StoryBiblePatchResolvedError extends Error {
  readonly patch: Patch;

  constructor(patch: Patch) {
    super(`The patch is already ${patch.status} and cannot be changed.`);
    this.name = "StoryBiblePatchResolvedError";
    this.patch = patch;
  }
}
