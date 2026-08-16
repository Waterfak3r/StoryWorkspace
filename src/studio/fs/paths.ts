import "server-only";

import fs from "node:fs";
import path from "node:path";

import { isStudioSlug } from "../domain";
import { StudioValidationError } from "../errors";

const ID_FIELD_LABELS: Record<string, string> = {
  projectId: "project id",
  volumeId: "volume id",
  chapterId: "chapter id",
  sceneId: "scene id",
  shotId: "shot id",
  entityId: "entity id",
  runId: "parse run id",
  id: "id",
};

export function isPathUnsafeId(value: string): boolean {
  if (value.includes("\0") || value.includes("..") || value.includes("/") || value.includes("\\") || value.includes(":")) {
    return true;
  }

  if (/^[a-zA-Z]:/.test(value)) {
    return true;
  }

  if (value.startsWith("\\\\") || value.startsWith("//")) {
    return true;
  }

  return path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}

export function assertStudioId(value: string, field = "id"): string {
  if (typeof value !== "string" || value.length === 0 || isPathUnsafeId(value) || !isStudioSlug(value)) {
    throw new StudioValidationError(`Invalid ${ID_FIELD_LABELS[field] ?? "id"}.`, field);
  }

  return value;
}

export function constrainToWorkspaceRoot(root: string, candidate: string): string {
  const resolved = path.resolve(candidate);
  const ancestor = existingAncestor(resolved);

  let ancestorReal: string;
  let rootReal: string;
  try {
    ancestorReal = fs.realpathSync(ancestor);
    rootReal = fs.realpathSync(root);
  } catch {
    throw new StudioValidationError("Path is outside the workspace.");
  }

  const remainder = path.relative(ancestor, resolved);
  if (
    remainder.startsWith("..") ||
    path.isAbsolute(remainder) ||
    path.win32.isAbsolute(remainder) ||
    path.posix.isAbsolute(remainder)
  ) {
    throw new StudioValidationError("Path is outside the workspace.");
  }

  const realCandidate = remainder === "" ? ancestorReal : path.resolve(ancestorReal, remainder);
  if (!isInsideRoot(rootReal, realCandidate)) {
    throw new StudioValidationError("Path is outside the workspace.");
  }

  return realCandidate;
}

export function resolveUnderWorkspace(root: string, segments: readonly string[]): string {
  return constrainToWorkspaceRoot(root, path.resolve(path.join(root, ...segments)));
}

function existingAncestor(target: string): string {
  let current = target;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw new StudioValidationError("Path is outside the workspace.");
    }
    current = parent;
  }
  return current;
}

function isInsideRoot(root: string, candidate: string): boolean {
  if (candidate === root) {
    return true;
  }

  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return candidate.startsWith(prefix);
}
