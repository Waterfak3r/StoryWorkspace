import "server-only";

import fs from "node:fs";

import {
  nextNumberedId,
  workflowNodeSchema,
  workflowRunSchema,
  type StudioShot,
  type StudioShotStatus,
  type StudioWorkflowNode,
  type StudioWorkflowRun,
  type StudioWorkflowStatusLabel,
} from "../domain";
import { parseJsonRecord, writeJsonFile } from "../fs/json";
import { assertStudioId, resolveUnderWorkspace } from "../fs/paths";
import { getWorkspaceRoot } from "../fs/workspace";

export const WORKFLOW_STATUS_LABELS: Record<StudioShotStatus, StudioWorkflowStatusLabel> = {
  pending: "待跑",
  success: "成功",
  failed: "失败",
  locked: "锁定",
};

export function statusLabelFor(status: StudioShotStatus): StudioWorkflowStatusLabel {
  return WORKFLOW_STATUS_LABELS[status];
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

export function tryReadWorkflowNode(projectId: string, shotId: string): StudioWorkflowNode | null {
  const id = assertStudioId(shotId, "shotId");
  const file = workflowNodeFile(projectId, id);
  if (!fs.existsSync(file)) {
    return null;
  }

  try {
    const node = parseJsonRecord(file, workflowNodeSchema);
    return node.shotId === id ? node : null;
  } catch {
    return null;
  }
}

export function writeWorkflowNode(projectId: string, node: StudioWorkflowNode): StudioWorkflowNode {
  writeJsonFile(workflowNodeFile(projectId, node.id), workflowNodeSchema.parse(node));
  return node;
}

export function deleteWorkflowNode(projectId: string, shotId: string): void {
  const file = workflowNodeFile(projectId, shotId);
  if (!fs.existsSync(file)) {
    return;
  }
  fs.rmSync(file, { force: true });
}

export function writeWorkflowRun(projectId: string, run: StudioWorkflowRun): StudioWorkflowRun {
  writeJsonFile(workflowRunFile(projectId, run.id), workflowRunSchema.parse(run));
  return run;
}

export function allocateRunId(projectId: string): string {
  return nextNumberedId("run", listRunIds(projectId));
}

export function nodeFromShot(input: {
  sceneId: string;
  shot: StudioShot;
  continuityConstraints?: string;
  previous?: StudioWorkflowNode | null;
}): StudioWorkflowNode {
  const previous = input.previous;

  return workflowNodeSchema.parse({
    id: input.shot.id,
    shotId: input.shot.id,
    sceneId: input.sceneId,
    status: input.shot.status,
    statusLabel: statusLabelFor(input.shot.status),
    locked: input.shot.status === "locked",
    selectedImage: input.shot.selected_image ?? "",
    continuityConstraints: input.continuityConstraints ?? previous?.continuityConstraints ?? "",
    updatedAt: input.shot.updatedAt,
  });
}

function workflowNodeFile(projectId: string, shotId: string): string {
  const project = assertStudioId(projectId, "projectId");
  const shot = assertStudioId(shotId, "shotId");
  return resolveUnderWorkspace(getWorkspaceRoot(), [project, "workflow", "nodes", `${shot}.json`]);
}

function workflowRunFile(projectId: string, runId: string): string {
  const project = assertStudioId(projectId, "projectId");
  const run = assertStudioId(runId, "runId");
  return resolveUnderWorkspace(getWorkspaceRoot(), [project, "workflow", "runs", `${run}.json`]);
}

function listRunIds(projectId: string): string[] {
  const project = assertStudioId(projectId, "projectId");
  const directory = resolveUnderWorkspace(getWorkspaceRoot(), [project, "workflow", "runs"]);
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

export function resolveProjectRelativeFile(projectId: string, relativePath: string): string {
  const project = assertStudioId(projectId, "projectId");
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === ".." || part.includes("\\"))) {
    throw new Error("Image adapter returned an unsafe path.");
  }

  return resolveUnderWorkspace(getWorkspaceRoot(), [project, ...parts]);
}

export function projectFileExists(target: string): boolean {
  try {
    return fs.existsSync(target) && fs.statSync(target).isFile() && fs.statSync(target).size > 0;
  } catch {
    return false;
  }
}

export function compareIds(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true });
}

export function nodeSortKey(node: StudioWorkflowNode): string {
  return `${node.sceneId}\0${node.shotId}`;
}
