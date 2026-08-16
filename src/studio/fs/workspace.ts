import "server-only";

import fs from "node:fs";
import path from "node:path";

import { StudioValidationError } from "../errors";

export const DEFAULT_WORKSPACE_ROOT = ".data/projects";

export function getWorkspaceRoot(): string {
  const configured = process.env.STORY_WORKSPACE_ROOT;
  const raw = configured && configured.trim() !== "" ? configured : DEFAULT_WORKSPACE_ROOT;
  const absolute = path.resolve(process.cwd(), raw);

  let stats: fs.Stats | undefined;
  try {
    stats = fs.statSync(absolute);
  } catch (error) {
    if (!isEnoent(error)) {
      throw new StudioValidationError("Workspace root is not available.");
    }
  }

  if (stats && !stats.isDirectory()) {
    throw new StudioValidationError("Workspace root is not a directory.");
  }

  fs.mkdirSync(absolute, { recursive: true });
  return fs.realpathSync(absolute);
}

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
