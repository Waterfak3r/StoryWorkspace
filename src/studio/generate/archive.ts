import "server-only";

import fs from "node:fs";
import path from "node:path";

import { nextNumberedId } from "../domain";
import { assertStudioId, resolveUnderWorkspace } from "../fs/paths";
import { getWorkspaceRoot } from "../fs/workspace";
import { comicsCurrentPagePath, comicsPanelWorkDir } from "./image-output";

export function allocateBatchId(projectId: string): string {
  const id = assertStudioId(projectId, "projectId");
  const archiveDir = resolveUnderWorkspace(getWorkspaceRoot(), [id, "outputs", "archive"]);
  const existing = fs.existsSync(archiveDir)
    ? fs.readdirSync(archiveDir).filter((name) => !name.startsWith("."))
    : [];
  return nextNumberedId("batch", existing);
}

export function archivePageOutputs(projectId: string, pageId: string): string | null {
  const project = assertStudioId(projectId, "projectId");
  const page = assertStudioId(pageId, "pageId");
  const currentRelative = comicsCurrentPagePath(page);
  const currentAbs = resolveProjectRelative(project, currentRelative);
  const panelsAbs = resolveProjectRelative(project, comicsPanelWorkDir(page));
  const hasCurrent = fs.existsSync(currentAbs);
  const hasPanels = fs.existsSync(panelsAbs);
  if (!hasCurrent && !hasPanels) {
    return null;
  }

  const batchId = allocateBatchId(project);
  const archiveRoot = resolveUnderWorkspace(getWorkspaceRoot(), [project, "outputs", "archive", batchId]);
  fs.mkdirSync(archiveRoot, { recursive: true });

  if (hasCurrent) {
    const dest = path.join(archiveRoot, `${page}.png`);
    fs.renameSync(currentAbs, dest);
  }

  if (hasPanels) {
    const dest = path.join(archiveRoot, "panels", page);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(panelsAbs, dest, { recursive: true });
  }

  return batchId;
}

function resolveProjectRelative(projectId: string, relativePath: string): string {
  return resolveUnderWorkspace(getWorkspaceRoot(), [projectId, ...relativePath.split("/")]);
}
