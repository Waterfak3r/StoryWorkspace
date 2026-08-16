import "server-only";

import { StudioConflictError } from "../errors";
import { nowIso, readParseRun, writeParseRun } from "./runs";
import type { StudioParseRun } from "./schemas";

export function rejectParseRun(projectId: string, runId: string): StudioParseRun {
  const run = readParseRun(projectId, runId);
  if (run.status === "confirmed") {
    throw new StudioConflictError("This parse run is already confirmed.");
  }
  if (run.status === "rejected") {
    return run;
  }

  return writeParseRun(projectId, {
    ...run,
    status: "rejected",
    updatedAt: nowIso(run.updatedAt),
  });
}
