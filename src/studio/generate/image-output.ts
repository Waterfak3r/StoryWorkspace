import "server-only";

import fs from "node:fs";
import path from "node:path";

import { StudioNotFoundError, StudioValidationError } from "../errors";
import { readProject } from "../fs";
import { assertStudioId, resolveUnderWorkspace } from "../fs/paths";
import { getWorkspaceRoot } from "../fs/workspace";
import type { ImageAdapterInput, ImageAdapterResult } from "./adapter";
import { resolveEntityReferenceFile } from "./entity-references";

export const MIN_RENDERABLE_PAGE_EDGE = 32;

export function comicsCurrentPagePath(pageId: string): string {
  return `outputs/comics/current/${pageId}.png`;
}

export function readPngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24) {
    return null;
  }
  if (bytes[0] !== 0x89 || bytes.subarray(1, 4).toString("ascii") !== "PNG") {
    return null;
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export function isRenderableComicsPng(bytes: Buffer): boolean {
  const size = readPngSize(bytes);
  return Boolean(
    size && size.width >= MIN_RENDERABLE_PAGE_EDGE && size.height >= MIN_RENDERABLE_PAGE_EDGE,
  );
}

export function isRenderableComicsFile(absolutePath: string): boolean {
  try {
    if (!fs.existsSync(absolutePath)) {
      return false;
    }
    return isRenderableComicsPng(fs.readFileSync(absolutePath));
  } catch {
    return false;
  }
}

export function comicsStagingPagePath(pageId: string): string {
  return `outputs/comics/staging/${pageId}.png`;
}

export function comicsPanelWorkDir(pageId: string): string {
  return `outputs/comics/panels/${pageId}`;
}

export function comicsPanelWorkPath(pageId: string, shotId: string): string {
  return `${comicsPanelWorkDir(pageId)}/${shotId}.png`;
}

export function writeShotImageFile(input: ImageAdapterInput, bytes: Buffer): ImageAdapterResult {
  const projectId = assertStudioId(input.projectId, "projectId");
  const runId = assertStudioId(input.runId, "runId");
  readProject(projectId);

  if (input.pageId && input.panelShotId) {
    return writePanelWorkFile(projectId, input.pageId, input.panelShotId, bytes);
  }

  if (input.pageId) {
    return writeStagingPageFile(projectId, input.pageId, bytes);
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

export function writeCurrentPageFile(
  projectId: string,
  pageId: string,
  bytes: Buffer,
): { relativePath: string } {
  return writePagePng(projectId, pageId, "current", bytes);
}

export function writeStagingPageFile(
  projectId: string,
  pageId: string,
  bytes: Buffer,
): { relativePath: string } {
  return writePagePng(projectId, pageId, "staging", bytes);
}

export function promoteStagingPageFile(projectId: string, pageId: string): { relativePath: string } {
  const project = assertStudioId(projectId, "projectId");
  const page = assertStudioId(pageId, "pageId");
  readProject(project);
  const stagingAbs = resolveUnderWorkspace(getWorkspaceRoot(), [project, "outputs", "comics", "staging", `${page}.png`]);
  if (!fs.existsSync(stagingAbs)) {
    throw new Error("Staging page image is missing.");
  }
  const currentAbs = resolveUnderWorkspace(getWorkspaceRoot(), [project, "outputs", "comics", "current", `${page}.png`]);
  fs.mkdirSync(path.dirname(currentAbs), { recursive: true });
  fs.renameSync(stagingAbs, currentAbs);
  return { relativePath: comicsCurrentPagePath(page) };
}

export function discardStagingPageFile(projectId: string, pageId: string): void {
  const project = assertStudioId(projectId, "projectId");
  const page = assertStudioId(pageId, "pageId");
  const stagingAbs = resolveUnderWorkspace(getWorkspaceRoot(), [project, "outputs", "comics", "staging", `${page}.png`]);
  if (fs.existsSync(stagingAbs)) {
    fs.rmSync(stagingAbs, { force: true });
  }
}

function writePagePng(
  projectId: string,
  pageId: string,
  slot: "current" | "staging",
  bytes: Buffer,
): { relativePath: string } {
  const project = assertStudioId(projectId, "projectId");
  const page = assertStudioId(pageId, "pageId");
  readProject(project);
  const relativePath = slot === "staging" ? comicsStagingPagePath(page) : comicsCurrentPagePath(page);
  const absolutePath = resolveUnderWorkspace(getWorkspaceRoot(), [project, "outputs", "comics", slot, `${page}.png`]);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, bytes);
  return { relativePath };
}

export function writePanelWorkFile(
  projectId: string,
  pageId: string,
  shotId: string,
  bytes: Buffer,
): { relativePath: string } {
  const project = assertStudioId(projectId, "projectId");
  const page = assertStudioId(pageId, "pageId");
  const shot = assertStudioId(shotId, "shotId");
  readProject(project);
  const relativePath = comicsPanelWorkPath(page, shot);
  const absolutePath = resolveUnderWorkspace(getWorkspaceRoot(), [
    project,
    "outputs",
    "comics",
    "panels",
    page,
    `${shot}.png`,
  ]);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, bytes);
  return { relativePath };
}

export function writeComicsPageFile(
  projectId: string,
  pageId: string,
  _runId: string,
  bytes: Buffer,
): { relativePath: string } {
  return writeCurrentPageFile(projectId, pageId, bytes);
}

export function resolveProjectStillFile(projectId: string, relativePath: string): string {
  const project = assertStudioId(projectId, "projectId");
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/");
  if (parts[0] === "assets") {
    const { absolutePath } = resolveEntityReferenceFile(project, normalized);
    return absolutePath;
  }
  if (parts[0] !== "outputs") {
    throw new StudioValidationError("Invalid still path.", "path");
  }
  readProject(project);

  const last = parts[parts.length - 1] ?? "";
  if (!last.endsWith(".png")) {
    throw new StudioValidationError("Invalid still path.", "path");
  }
  const lastId = assertStudioId(last.slice(0, -".png".length), "id");

  let segments: string[];
  if (parts.length === 4 && parts[1] === "comics" && parts[2] === "current") {
    segments = ["outputs", "comics", "current", `${lastId}.png`];
  } else if (parts.length !== 5) {
    throw new StudioValidationError("Invalid still path.", "path");
  } else if (parts[1] === "images") {
    const sceneId = assertStudioId(parts[2] ?? "", "sceneId");
    const shotId = assertStudioId(parts[3] ?? "", "shotId");
    segments = ["outputs", "images", sceneId, shotId, `${lastId}.png`];
  } else if (parts[1] === "comics" && parts[2] === "pages") {
    const pageId = assertStudioId(parts[3] ?? "", "pageId");
    segments = ["outputs", "comics", "pages", pageId, `${lastId}.png`];
  } else if (parts[1] === "comics" && parts[2] === "panels") {
    const pageId = assertStudioId(parts[3] ?? "", "pageId");
    segments = ["outputs", "comics", "panels", pageId, `${lastId}.png`];
  } else {
    throw new StudioValidationError("Invalid still path.", "path");
  }

  const absolutePath = resolveUnderWorkspace(getWorkspaceRoot(), [project, ...segments]);
  if (!fs.existsSync(absolutePath)) {
    throw new StudioNotFoundError("Image not found.");
  }
  return absolutePath;
}
