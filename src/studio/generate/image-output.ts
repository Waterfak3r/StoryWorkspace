import "server-only";

import fs from "node:fs";
import path from "node:path";

import { readProject } from "../fs";
import { assertStudioId, resolveUnderWorkspace } from "../fs/paths";
import { getWorkspaceRoot } from "../fs/workspace";
import type { ImageAdapterInput, ImageAdapterResult } from "./adapter";

export function writeShotImageFile(input: ImageAdapterInput, bytes: Buffer): ImageAdapterResult {
  const projectId = assertStudioId(input.projectId, "projectId");
  const sceneId = assertStudioId(input.sceneId, "sceneId");
  const shotId = assertStudioId(input.shotId, "shotId");
  const runId = assertStudioId(input.runId, "runId");
  readProject(projectId);

  const relativePath = `outputs/images/${sceneId}/${shotId}/${runId}.png`;
  const absolutePath = resolveUnderWorkspace(getWorkspaceRoot(), [
    projectId,
    "outputs",
    "images",
    sceneId,
    shotId,
    `${runId}.png`,
  ]);

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, bytes);

  return { relativePath };
}
