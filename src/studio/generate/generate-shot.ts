import "server-only";

import fs from "node:fs";

import { composeComicsPagePng } from "../comics/compose-page";
import { planScenePages } from "../comics/plan-pages";
import { resolveContext } from "../context";
import { confirmedSpeechByShot } from "../dialogue";
import type {
  ComposeMode,
  PageLayout,
  StudioContextSnapshot,
  StudioGenerateMode,
  StudioShot,
  StudioShotStatus,
  StudioWorkflowNode,
  StudioWorkflowRun,
} from "../domain";
import { StudioAiError, StudioConflictError, StudioNotFoundError } from "../errors";
import { readScene, readStyle, readTree, replaceSceneShots } from "../fs";
import { assertStudioId } from "../fs/paths";
import { isImageProviderConfigured } from "../settings";
import type { ImageAdapter } from "./adapter";
import { withImageAdapterRetry } from "./adapter";
import { archivePageOutputs } from "./archive";
import { buildContinuityConstraints, compileComicsPagePrompt, entitiesForShot, type CompiledImageRequest } from "./compile-prompt";
import { identityReferencePromptLines, loadEntityReferenceImages } from "./entity-references";
import { fakeImageAdapter } from "./fake-image-adapter";
import {
  comicsCurrentPagePath,
  comicsPanelWorkPath,
  comicsStagingPagePath,
  discardStagingPageFile,
  isRenderableComicsFile,
  promoteStagingPageFile,
  writeStagingPageFile,
} from "./image-output";
import { openaiCompatibleImageAdapter } from "./openai-image-adapter";
import {
  allocateRunId,
  compareIds,
  nodeFromShot,
  nodeSortKey,
  nowIso,
  projectFileExists,
  resolveProjectRelativeFile,
  tryReadWorkflowNode,
  writeWorkflowNode,
  writeWorkflowRun,
} from "./workflow-store";

export type GenerateShotOptions = {
  mode?: StudioGenerateMode;
  pageSize?: number;
  image?: {
    model?: string;
    size?: string;
    quality?: string;
  };
};

export type GenerateShotResult = {
  shot: StudioShot;
  node: StudioWorkflowNode;
  run: StudioWorkflowRun;
  snapshot: StudioContextSnapshot & { continuityConstraints: string };
  compiled: CompiledImageRequest;
  continuityConstraints: string;
};

const defaultImageAdapter: ImageAdapter = withImageAdapterRetry(async (input) => {
  const adapter = isImageProviderConfigured() ? openaiCompatibleImageAdapter : fakeImageAdapter;
  return adapter(input);
});

export async function generateShot(
  projectId: string,
  volumeId: string,
  chapterId: string,
  sceneId: string,
  shotId: string,
  options: GenerateShotOptions = {},
  adapter: ImageAdapter = defaultImageAdapter,
): Promise<GenerateShotResult> {
  const mode = options.mode ?? "generate";
  let scene = readScene(projectId, volumeId, chapterId, sceneId);
  const current = requireShot(scene.shots, shotId);
  if (current.status === "locked") {
    throw new StudioConflictError("This shot is locked and cannot be regenerated.");
  }

  const style = readStyle(projectId);
  const compose: ComposeMode = style.compose ?? "page";
  const layout = effectiveLayout(style.layout, options.pageSize);
  scene = persistPlannedPageIds(projectId, volumeId, chapterId, sceneId, layout);
  const planned = planScenePages(sceneId, scene.shots, layout);
  const currentPlan = planned.find((item) => item.shotId === current.id);
  const pageId = currentPlan?.pageId ?? "";
  const pagePlans = planned.filter((item) => item.pageId === pageId).sort((left, right) => left.panelIndex - right.panelIndex);
  const pageShots = pagePlans.map((item) => requireShot(scene.shots, item.shotId));
  if (pageShots.some((shot) => shot.status === "locked")) {
    throw new StudioConflictError("This comics page has a locked shot and cannot be regenerated.");
  }

  const snapshots = pageShots.map((shot) =>
    resolveContext({ projectId, volumeId, chapterId, sceneId, shotId: shot.id }),
  );
  const snapshot = snapshots.find((item) => item.shot.id === current.id) ?? snapshots[0]!;
  const continuityConstraints = buildContinuityConstraints(snapshot);
  const referenceImages = loadEntityReferenceImages(
    projectId,
    uniqueEntities(snapshots.flatMap((item) => entitiesForShot(item))),
  );
  const identityLines = identityReferencePromptLines(referenceImages);
  const speech = confirmedSpeechByShot(scene);
  const compiled = compileComicsPagePrompt(
    compose === "panels" ? [snapshot] : snapshots,
    mode === "regenerate" ? continuityConstraints : "",
    identityLines,
    speech,
    style.lettering,
    { layout: layoutAsPageLayout(layout), compose },
  );
  applyImageOverrides(compiled, options);
  const storedConstraints = mode === "regenerate" ? continuityConstraints : "";
  const runId = allocateRunId(projectId);
  const previousNode = tryReadWorkflowNode(projectId, current.id);
  const currentPath = comicsCurrentPagePath(pageId);

  let relativePath = "";
  try {
    if (compose === "panels") {
      await generatePanelPage({
        projectId,
        sceneId,
        pageId,
        pageShots,
        snapshots,
        currentId: current.id,
        mode,
        runId,
        layout,
        compose,
        identityLines,
        speech,
        lettering: style.lettering,
        referenceImages,
        adapter,
        image: options.image,
        storedConstraints,
      });
    } else {
      const output = await adapter({
        projectId,
        sceneId,
        shotId: current.id,
        runId,
        pageId,
        prompt: compiled.prompt,
        referenceImages,
        provider: compiled.provider,
      });
      const writtenPath = output.relativePath.trim();
      if (!writtenPath) {
        throw new Error("Image adapter returned an empty path.");
      }
      const written = resolveProjectRelativeFile(projectId, writtenPath);
      if (!projectFileExists(written)) {
        throw new Error("Image adapter did not write an image file.");
      }
    }
    const stagingAbs = resolveProjectRelativeFile(projectId, comicsStagingPagePath(pageId));
    if (!projectFileExists(stagingAbs)) {
      throw new Error("Staging page image is missing.");
    }
    if (!isRenderableComicsFile(stagingAbs)) {
      throw new Error("Image adapter wrote an unusable stub page.");
    }
    archivePageOutputs(projectId, pageId);
    promoteStagingPageFile(projectId, pageId);
    relativePath = currentPath;
  } catch (error) {
    discardStagingPageFile(projectId, pageId);
    let failed = current;
    for (const member of pageShots) {
      const next = persistShot(projectId, volumeId, chapterId, sceneId, member.id, { status: "failed", pageId });
      writeWorkflowNode(
        projectId,
        nodeFromShot({
          sceneId,
          shot: next,
          continuityConstraints: storedConstraints,
          previous: tryReadWorkflowNode(projectId, member.id),
        }),
      );
      if (member.id === current.id) {
        failed = next;
      }
    }
    writeWorkflowRun(projectId, {
      id: runId,
      shotId: failed.id,
      sceneId,
      mode,
      status: "failed",
      prompt: compiled.prompt,
      selectedImage: failed.selected_image,
      continuityConstraints: storedConstraints,
      createdAt: nowIso(),
    });
    throw toGenerationError(error);
  }

  let shot = current;
  for (const member of pageShots) {
    const next = persistShot(projectId, volumeId, chapterId, sceneId, member.id, {
      status: "success",
      selected_image: relativePath,
      pageId,
    });
    writeWorkflowNode(
      projectId,
      nodeFromShot({
        sceneId,
        shot: next,
        continuityConstraints: member.id === current.id ? storedConstraints : tryReadWorkflowNode(projectId, member.id)?.continuityConstraints ?? "",
        previous: tryReadWorkflowNode(projectId, member.id),
      }),
    );
    if (member.id === current.id) {
      shot = next;
    }
  }
  const node = writeWorkflowNode(
    projectId,
    nodeFromShot({
      sceneId,
      shot,
      continuityConstraints: storedConstraints,
      previous: previousNode,
    }),
  );
  const run = writeWorkflowRun(projectId, {
    id: runId,
    shotId: shot.id,
    sceneId,
    mode,
    status: "success",
    prompt: compiled.prompt,
    selectedImage: shot.selected_image,
    continuityConstraints: storedConstraints,
    createdAt: nowIso(),
  });

  return {
    shot,
    node,
    run,
    snapshot: { ...snapshot, continuityConstraints: storedConstraints },
    compiled,
    continuityConstraints: storedConstraints,
  };
}

export function lockShot(
  projectId: string,
  volumeId: string,
  chapterId: string,
  sceneId: string,
  shotId: string,
): { shot: StudioShot; node: StudioWorkflowNode } {
  return setShotLock(projectId, volumeId, chapterId, sceneId, shotId, true);
}

export function unlockShot(
  projectId: string,
  volumeId: string,
  chapterId: string,
  sceneId: string,
  shotId: string,
): { shot: StudioShot; node: StudioWorkflowNode } {
  return setShotLock(projectId, volumeId, chapterId, sceneId, shotId, false);
}

export function listWorkflowNodes(projectId: string): StudioWorkflowNode[] {
  const locations = listShotLocations(projectId);
  const nodes = locations.map((location) => {
    const stored = tryReadWorkflowNode(projectId, location.shot.id);
    const previous = stored && stored.sceneId === location.sceneId ? stored : null;
    return nodeFromShot({
      sceneId: location.sceneId,
      shot: location.shot,
      previous,
    });
  });

  return nodes.sort((left, right) => compareIds(nodeSortKey(left), nodeSortKey(right)));
}

export async function rerunUnlockedShot(
  projectId: string,
  shotId: string,
  adapter: ImageAdapter = defaultImageAdapter,
): Promise<GenerateShotResult> {
  const location = findShotLocation(projectId, shotId);
  if (location.shot.status === "locked") {
    throw new StudioConflictError("This shot is locked and cannot be regenerated.");
  }

  return generateShot(
    projectId,
    location.volumeId,
    location.chapterId,
    location.sceneId,
    location.shot.id,
    { mode: "regenerate" },
    adapter,
  );
}

type ShotLocation = {
  volumeId: string;
  chapterId: string;
  sceneId: string;
  shot: StudioShot;
};

function setShotLock(
  projectId: string,
  volumeId: string,
  chapterId: string,
  sceneId: string,
  shotId: string,
  locked: boolean,
): { shot: StudioShot; node: StudioWorkflowNode } {
  const scene = readScene(projectId, volumeId, chapterId, sceneId);
  const current = requireShot(scene.shots, shotId);
  const previous = tryReadWorkflowNode(projectId, current.id);
  const nextStatus: StudioShotStatus = locked
    ? "locked"
    : current.selected_image
      ? "success"
      : "pending";
  const shot = persistShot(projectId, volumeId, chapterId, sceneId, current.id, { status: nextStatus });
  const node = writeWorkflowNode(
    projectId,
    nodeFromShot({
      sceneId,
      shot,
      previous,
    }),
  );
  return { shot, node };
}

function persistPlannedPageIds(
  projectId: string,
  volumeId: string,
  chapterId: string,
  sceneId: string,
  layout: PageLayout | number,
) {
  const scene = readScene(projectId, volumeId, chapterId, sceneId);
  const planned = planScenePages(sceneId, scene.shots, layout);
  const pageByShot = new Map(planned.map((item) => [item.shotId, item.pageId]));
  let changed = false;
  const shots = scene.shots.map((shot) => {
    const pageId = pageByShot.get(shot.id) ?? "";
    if (shot.pageId === pageId) {
      return shot;
    }
    changed = true;
    return { ...shot, pageId, updatedAt: nowIso(shot.updatedAt) };
  });
  if (!changed) {
    return scene;
  }
  return replaceSceneShots(projectId, volumeId, chapterId, sceneId, shots);
}

function effectiveLayout(layout: PageLayout, pageSize?: number): PageLayout | number {
  if (pageSize && pageSize > 0) {
    return pageSize;
  }
  return layout ?? "auto";
}

function applyImageOverrides(compiled: CompiledImageRequest, options: GenerateShotOptions) {
  if (options.image?.model) {
    compiled.provider.model = options.image.model;
  }
  if (options.image?.size) {
    compiled.provider.size = options.image.size;
  }
  if (options.image?.quality) {
    compiled.provider.quality = options.image.quality;
  }
}

async function generatePanelPage(input: {
  projectId: string;
  sceneId: string;
  pageId: string;
  pageShots: readonly StudioShot[];
  snapshots: readonly StudioContextSnapshot[];
  currentId: string;
  mode: StudioGenerateMode;
  runId: string;
  layout: PageLayout | number;
  compose: ComposeMode;
  identityLines: readonly string[];
  speech: ReturnType<typeof confirmedSpeechByShot>;
  lettering: ReturnType<typeof readStyle>["lettering"];
  referenceImages: ReturnType<typeof loadEntityReferenceImages>;
  adapter: ImageAdapter;
  image?: GenerateShotOptions["image"];
  storedConstraints: string;
}): Promise<string> {
  const compileLayout: PageLayout = input.layout === "marvel" ? "auto" : layoutAsPageLayout(input.layout);
  for (const member of input.pageShots) {
    const snapshot = input.snapshots.find((item) => item.shot.id === member.id);
    if (!snapshot) {
      continue;
    }
    const workPath = comicsPanelWorkPath(input.pageId, member.id);
    const workAbs = resolveProjectRelativeFile(input.projectId, workPath);
    const redrawCurrent = input.mode === "regenerate" && member.id === input.currentId;
    if (!redrawCurrent && projectFileExists(workAbs)) {
      continue;
    }
    const compiled = compileComicsPagePrompt(
      [snapshot],
      redrawCurrent ? input.storedConstraints : "",
      input.identityLines,
      input.speech,
      input.lettering,
      { layout: compileLayout, compose: "panels" },
    );
    applyImageOverrides(compiled, { image: input.image });
    const output = await input.adapter({
      projectId: input.projectId,
      sceneId: input.sceneId,
      shotId: member.id,
      runId: input.runId,
      pageId: input.pageId,
      panelShotId: member.id,
      prompt: compiled.prompt,
      referenceImages: input.referenceImages,
      provider: compiled.provider,
    });
    const relativePath = output.relativePath.trim();
    if (!relativePath) {
      throw new Error("Image adapter returned an empty path.");
    }
    const written = resolveProjectRelativeFile(input.projectId, relativePath);
    if (!projectFileExists(written)) {
      throw new Error("Image adapter did not write an image file.");
    }
  }

  const buffers: Buffer[] = [];
  for (const member of input.pageShots) {
    const workAbs = resolveProjectRelativeFile(input.projectId, comicsPanelWorkPath(input.pageId, member.id));
    if (!projectFileExists(workAbs)) {
      throw new Error("Panel work image is missing.");
    }
    buffers.push(fs.readFileSync(workAbs));
  }
  return writeStagingPageFile(input.projectId, input.pageId, composeComicsPagePng(buffers)).relativePath;
}

function layoutAsPageLayout(layout: PageLayout | number): PageLayout {
  if (layout === 2 || layout === 3 || layout === 4) {
    return String(layout) as PageLayout;
  }
  if (layout === "2" || layout === "3" || layout === "4" || layout === "auto" || layout === "marvel") {
    return layout;
  }
  return "auto";
}

function persistShot(
  projectId: string,
  volumeId: string,
  chapterId: string,
  sceneId: string,
  shotId: string,
  patch: Partial<Pick<StudioShot, "status" | "selected_image" | "pageId">>,
): StudioShot {
  const scene = readScene(projectId, volumeId, chapterId, sceneId);
  const index = scene.shots.findIndex((shot) => shot.id === shotId);
  const current = scene.shots[index];
  if (index < 0 || !current) {
    throw new StudioNotFoundError("Shot not found.");
  }

  const next: StudioShot = {
    ...current,
    ...patch,
    updatedAt: nowIso(current.updatedAt),
  };
  const shots = scene.shots.slice();
  shots[index] = next;
  replaceSceneShots(projectId, volumeId, chapterId, sceneId, shots);
  return next;
}

function listShotLocations(projectId: string): ShotLocation[] {
  const tree = readTree(projectId);
  const locations: ShotLocation[] = [];
  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      for (const sceneNode of chapter.scenes) {
        const scene = readScene(projectId, volume.id, chapter.id, sceneNode.id);
        for (const shot of scene.shots) {
          locations.push({
            volumeId: volume.id,
            chapterId: chapter.id,
            sceneId: scene.id,
            shot,
          });
        }
      }
    }
  }
  return locations;
}

function findShotLocation(projectId: string, shotId: string): ShotLocation {
  const id = assertStudioId(shotId, "shotId");
  const stored = tryReadWorkflowNode(projectId, id);
  const locations = listShotLocations(projectId);
  const match =
    (stored ? locations.find((location) => location.shot.id === id && location.sceneId === stored.sceneId) : undefined) ??
    locations.find((location) => location.shot.id === id);
  if (!match) {
    throw new StudioNotFoundError("Shot not found.");
  }
  return match;
}

function uniqueEntities<T extends { id: string }>(entities: readonly T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const entity of entities) {
    if (seen.has(entity.id)) {
      continue;
    }
    seen.add(entity.id);
    unique.push(entity);
  }
  return unique;
}

function requireShot(shots: readonly StudioShot[], shotId: string): StudioShot {
  const shot = shots.find((candidate) => candidate.id === shotId);
  if (!shot) {
    throw new StudioNotFoundError("Shot not found.");
  }
  return shot;
}

function toGenerationError(error: unknown): Error {
  if (error instanceof StudioAiError || error instanceof StudioConflictError || error instanceof StudioNotFoundError) {
    return error;
  }

  const message = error instanceof Error ? error.message : "Image generation failed.";
  return new StudioAiError("GENERATION_FAILED", message, 502, true);
}
