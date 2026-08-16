import "server-only";

import fs from "node:fs";
import path from "node:path";

import { StudioNotFoundError, StudioValidationError } from "../errors";
import { readProject } from "../fs";
import { assertStudioId, resolveUnderWorkspace } from "../fs/paths";
import { getWorkspaceRoot } from "../fs/workspace";
import type { ImageAdapterInput, ImageAdapterResult } from "./adapter";
import { resolveEntityReferenceFile } from "./entity-references";

export function writeShotImageFile(input: ImageAdapterInput, bytes: Buffer): ImageAdapterResult {
  const projectId = assertStudioId(input.projectId, "projectId");
  const runId = assertStudioId(input.runId, "runId");
  readProject(projectId);

  if (input.pageId) {
    const pageId = assertStudioId(input.pageId, "pageId");
    const relativePath = `outputs/comics/pages/${pageId}/${runId}.png`;
    const absolutePath = resolveUnderWorkspace(getWorkspaceRoot(), [
      projectId,
      "outputs",
      "comics",
      "pages",
      pageId,
      `${runId}.png`,
    ]);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, bytes);
    return { relativePath };
  }

  const sceneId = assertStudioId(input.sceneId, "sceneId");
  const shotId = assertStudioId(input.shotId, "shotId");
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

export function writeComicsPageFile(
  projectId: string,
  pageId: string,
  runId: string,
  bytes: Buffer,
): { relativePath: string } {
  return writeShotImageFile(
    {
      projectId,
      sceneId: "scene-01",
      shotId: "shot-01",
      runId,
      pageId,
      prompt: "",
      provider: { model: "", size: "", quality: "" },
    },
    bytes,
  );
}

export function resolveProjectStillFile(projectId: string, relativePath: string): string {
  const project = assertStudioId(projectId, "projectId");
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/");
  if (parts[0] === "assets") {
    const { absolutePath } = resolveEntityReferenceFile(project, normalized);
    return absolutePath;
  }
  if (parts.length !== 5 || parts[0] !== "outputs") {
    throw new StudioValidationError("Invalid still path.", "path");
  }

  const file = parts[4] ?? "";
  if (!file.endsWith(".png")) {
    throw new StudioValidationError("Invalid still path.", "path");
  }
  const runId = assertStudioId(file.slice(0, -".png".length), "id");
  readProject(project);

  let segments: string[];
  if (parts[1] === "images") {
    const sceneId = assertStudioId(parts[2] ?? "", "sceneId");
    const shotId = assertStudioId(parts[3] ?? "", "shotId");
    segments = ["outputs", "images", sceneId, shotId, `${runId}.png`];
  } else if (parts[1] === "comics" && parts[2] === "pages") {
    const pageId = assertStudioId(parts[3] ?? "", "pageId");
    segments = ["outputs", "comics", "pages", pageId, `${runId}.png`];
  } else {
    throw new StudioValidationError("Invalid still path.", "path");
  }

  const absolutePath = resolveUnderWorkspace(getWorkspaceRoot(), [project, ...segments]);
  if (!fs.existsSync(absolutePath)) {
    throw new StudioNotFoundError("Image not found.");
  }
  return absolutePath;
}
