import "server-only";

import fs from "node:fs";

import {
  COMICS_PANELS_PER_PAGE,
  comicsBookSchema,
  type StudioComicsBook,
  type StudioComicsPage,
} from "../domain";
import { readProject, readScene, readTree } from "../fs";
import { resolveProjectStillFile, writeComicsPageFile } from "../generate/image-output";
import { composeComicsPagePng } from "./compose-page";

export type ComicsStillFrame = {
  volumeId: string;
  chapterId: string;
  sceneId: string;
  shotId: string;
  stillPath: string;
  caption: string;
};

export function paginateComicsStills(frames: readonly ComicsStillFrame[]): StudioComicsPage[] {
  const pages: StudioComicsPage[] = [];

  for (let offset = 0; offset < frames.length; offset += COMICS_PANELS_PER_PAGE) {
    const slice = frames.slice(offset, offset + COMICS_PANELS_PER_PAGE);
    const pageIndex = pages.length;
    pages.push({
      index: pageIndex,
      pageImage: slice[0]?.stillPath ?? "",
      panels: slice.map((frame, panelIndex) => ({
        pageIndex,
        panelIndex,
        volumeId: frame.volumeId,
        chapterId: frame.chapterId,
        sceneId: frame.sceneId,
        shotId: frame.shotId,
        stillPath: frame.stillPath,
        caption: frame.caption,
      })),
    });
  }

  return pages;
}

export function collectComicsStillFrames(projectId: string): ComicsStillFrame[] {
  const tree = readTree(projectId);
  const frames: ComicsStillFrame[] = [];

  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      for (const sceneNode of chapter.scenes) {
        const scene = readScene(projectId, volume.id, chapter.id, sceneNode.id);
        for (const shot of scene.shots) {
          const stillPath = shot.selected_image?.trim() ?? "";
          if (!stillPath) {
            continue;
          }
          frames.push({
            volumeId: volume.id,
            chapterId: chapter.id,
            sceneId: scene.id,
            shotId: shot.id,
            stillPath,
            caption: shot.action,
          });
        }
      }
    }
  }

  return frames;
}

export function assembleComicsBook(projectId: string): StudioComicsBook {
  const project = readProject(projectId);
  const pages = paginateComicsStills(collectComicsStillFrames(projectId)).map((page) => ({
    ...page,
    pageImage: ensurePageImage(projectId, page),
  }));
  return comicsBookSchema.parse({
    projectId: project.id,
    title: project.title,
    pages,
  });
}

function ensurePageImage(projectId: string, page: StudioComicsPage): string {
  const paths = page.panels.map((panel) => panel.stillPath);
  const unique = [...new Set(paths)];
  if (unique.length <= 1) {
    return unique[0] ?? page.pageImage;
  }

  const buffers: Buffer[] = [];
  for (const relativePath of paths) {
    const bytes = tryReadStillBytes(projectId, relativePath);
    if (!bytes) {
      return paths[0] ?? page.pageImage;
    }
    buffers.push(bytes);
  }

  const composed = composeComicsPagePng(buffers);
  return writeComicsPageFile(projectId, `page-${String(page.index + 1).padStart(2, "0")}`, "composed", composed)
    .relativePath;
}

function tryReadStillBytes(projectId: string, relativePath: string): Buffer | null {
  try {
    return fs.readFileSync(resolveProjectStillFile(projectId, relativePath));
  } catch {
    return null;
  }
}
