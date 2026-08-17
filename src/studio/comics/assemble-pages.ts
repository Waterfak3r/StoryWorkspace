import "server-only";

import fs from "node:fs";

import {
  COMICS_PANELS_PER_PAGE,
  comicsBookSchema,
  type StudioAttributedSpeechLine,
  type StudioComicsBook,
  type StudioComicsPage,
  type StudioEntity,
} from "../domain";
import { assignDialogueToShots, compilePageLettering, extractAttributedDialogue } from "../dialogue";
import { readEntity, readProject, readScene, readTree } from "../fs";
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
        speech: [],
      })),
      lettering: [],
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
  const pages = paginateGeneratedAndLegacyPages(collectComicsStillFrames(projectId)).map((page, index) => {
    const next = {
      ...page,
      index,
      pageImage: ensurePageImage(projectId, { ...page, index }),
      panels: page.panels.map((panel, panelIndex) => ({ ...panel, pageIndex: index, panelIndex })),
    };
    return letterPage(projectId, next);
  });
  return comicsBookSchema.parse({
    projectId: project.id,
    title: project.title,
    pages,
  });
}

function paginateGeneratedAndLegacyPages(frames: readonly ComicsStillFrame[]): StudioComicsPage[] {
  const pages: StudioComicsPage[] = [];
  const leftover: ComicsStillFrame[] = [];

  const flushLeftover = () => {
    if (leftover.length === 0) {
      return;
    }
    pages.push(...paginateComicsStills(leftover.splice(0)));
  };

  let index = 0;
  while (index < frames.length) {
    const current = frames[index]!;
    let end = index + 1;
    while (end < frames.length && frames[end]?.stillPath === current.stillPath) {
      end += 1;
    }
    const run = frames.slice(index, end);
    const generatedPage = current.stillPath.startsWith("outputs/comics/pages/") || run.length > 1;
    if (generatedPage) {
      flushLeftover();
      pages.push({
        index: pages.length,
        pageImage: current.stillPath,
        panels: run.map((frame, panelIndex) => ({
          pageIndex: pages.length,
          panelIndex,
          volumeId: frame.volumeId,
          chapterId: frame.chapterId,
          sceneId: frame.sceneId,
          shotId: frame.shotId,
          stillPath: frame.stillPath,
          caption: frame.caption,
          speech: [],
        })),
        lettering: [],
      });
    } else {
      leftover.push(current);
    }
    index = end;
  }
  flushLeftover();
  return pages;
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

function letterPage(projectId: string, page: StudioComicsPage): StudioComicsPage {
  const speechByShot = new Map<string, StudioAttributedSpeechLine[]>();
  const seenScenes = new Set<string>();

  for (const panel of page.panels) {
    const key = `${panel.volumeId}/${panel.chapterId}/${panel.sceneId}`;
    if (seenScenes.has(key)) {
      continue;
    }
    seenScenes.add(key);
    const scene = readScene(projectId, panel.volumeId, panel.chapterId, panel.sceneId);
    const characters = scene.characters
      .map((id) => tryReadCharacter(projectId, id))
      .filter((entity): entity is { id: string; name: string } => entity !== null);
    const lines = extractAttributedDialogue(scene.script, characters);
    for (const assignment of assignDialogueToShots(lines, scene.shots)) {
      speechByShot.set(assignment.shotId, assignment.lines);
    }
  }

  const panels = page.panels.map((panel) => ({
    ...panel,
    speech: speechByShot.get(panel.shotId) ?? [],
  }));

  return {
    ...page,
    panels,
    lettering: compilePageLettering(
      panels.map((panel) => ({
        shotId: panel.shotId,
        panelIndex: panel.panelIndex,
        lines: panel.speech,
      })),
    ),
  };
}

function tryReadCharacter(projectId: string, entityId: string): { id: string; name: string } | null {
  let entity: StudioEntity;
  try {
    entity = readEntity(projectId, entityId);
  } catch {
    return null;
  }
  if (entity.kind !== "character") {
    return null;
  }
  return { id: entity.id, name: entity.name };
}
