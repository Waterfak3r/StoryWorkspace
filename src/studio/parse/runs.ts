import "server-only";

import fs from "node:fs";
import path from "node:path";

import { nextNumberedId } from "../domain";
import { StudioNotFoundError } from "../errors";
import { readProject } from "../fs";
import { parseJsonRecord, writeJsonFile } from "../fs/json";
import { assertStudioId, resolveUnderWorkspace } from "../fs/paths";
import { getWorkspaceRoot } from "../fs/workspace";
import { parseRunRecordSchema, type StudioParseRun } from "./schemas";

export function listParseRuns(projectId: string): StudioParseRun[] {
  readProject(projectId);
  const directory = parseRunsDir(projectId);
  if (!fs.existsSync(directory)) {
    return [];
  }

  const runs: StudioParseRun[] = [];
  for (const id of listRunIds(directory)) {
    const run = tryReadParseRunFile(path.join(directory, `${id}.json`), id);
    if (run) {
      runs.push(run);
    }
  }

  return runs.sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));
}

export function readParseRun(projectId: string, runId: string): StudioParseRun {
  readProject(projectId);
  const id = assertStudioId(runId, "runId");
  const file = parseRunFile(projectId, id);
  if (!fs.existsSync(file)) {
    throw new StudioNotFoundError("Parse run not found.");
  }

  const run = parseJsonRecord(file, parseRunRecordSchema);
  if (run.id !== id) {
    throw new StudioNotFoundError("Parse run not found.");
  }

  return run;
}

export function allocateParseRunId(projectId: string): string {
  const directory = parseRunsDir(projectId);
  return nextNumberedId("parse", listRunIds(directory));
}

export function writeParseRun(projectId: string, run: StudioParseRun): StudioParseRun {
  writeJsonFile(parseRunFile(projectId, run.id), run);
  return run;
}

export function nowIso(previous?: string): string {
  const now = new Date().toISOString();
  if (previous && now <= previous) {
    const millis = Date.parse(previous);
    if (Number.isFinite(millis)) {
      return new Date(millis + 1).toISOString();
    }
  }
  return now;
}

function parseRunsDir(projectId: string): string {
  const root = getWorkspaceRoot();
  const id = assertStudioId(projectId, "projectId");
  return resolveUnderWorkspace(root, [id, "imports", "parse-runs"]);
}

function parseRunFile(projectId: string, runId: string): string {
  const root = getWorkspaceRoot();
  const project = assertStudioId(projectId, "projectId");
  const run = assertStudioId(runId, "runId");
  return resolveUnderWorkspace(root, [project, "imports", "parse-runs", `${run}.json`]);
}

function listRunIds(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const ids: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const id = entry.name.slice(0, -".json".length);
    try {
      ids.push(assertStudioId(id, "runId"));
    } catch {
      // Skip temp or non-slug files.
    }
  }

  return ids;
}

function tryReadParseRunFile(filePath: string, runId: string): StudioParseRun | null {
  try {
    const run = parseJsonRecord(filePath, parseRunRecordSchema);
    return run.id === runId ? run : null;
  } catch {
    return null;
  }
}
