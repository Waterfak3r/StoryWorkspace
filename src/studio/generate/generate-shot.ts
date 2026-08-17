import "server-only";

import { comicsPageGroup, comicsPageId } from "../comics/page-group";
import { resolveContext } from "../context";
import { assignDialogueToShots, extractAttributedDialogue, speechByShotId } from "../dialogue";
import type {
  StudioContextSnapshot,
  StudioGenerateMode,
  StudioShot,
  StudioShotStatus,
  StudioWorkflowNode,
  StudioWorkflowRun,
} from "../domain";
import { StudioAiError, StudioConflictError, StudioNotFoundError } from "../errors";
import { readScene, readTree, replaceSceneShots } from "../fs";
import { assertStudioId } from "../fs/paths";
import { isImageProviderConfigured } from "../settings";
import type { ImageAdapter } from "./adapter";
import { withImageAdapterRetry } from "./adapter";
import { buildContinuityConstraints, compileComicsPagePrompt, entitiesForShot, type CompiledImageRequest } from "./compile-prompt";
import { identityReferencePromptLines, loadEntityReferenceImages } from "./entity-references";
import { fakeImageAdapter } from "./fake-image-adapter";
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
  const scene = readScene(projectId, volumeId, chapterId, sceneId);
  const current = requireShot(scene.shots, shotId);
  if (current.status === "locked") {
    throw new StudioConflictError("This shot is locked and cannot be regenerated.");
  }

  const shotIndex = scene.shots.findIndex((shot) => shot.id === current.id);
  const pageSize = options.pageSize && options.pageSize > 0 ? options.pageSize : undefined;
  const pageShots = comicsPageGroup(scene.shots, shotIndex, pageSize);
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
  const speakers = snapshot.entities
    .filter((entity) => entity.kind === "character")
    .map((entity) => ({ id: entity.id, name: entity.name }));
  const dialogue = assignDialogueToShots(extractAttributedDialogue(scene.script, speakers), pageShots);
  const compiled = compileComicsPagePrompt(
    snapshots,
    mode === "regenerate" ? continuityConstraints : "",
    identityReferencePromptLines(referenceImages),
    speechByShotId(dialogue),
  );
  if (options.image?.model) {
    compiled.provider.model = options.image.model;
  }
  if (options.image?.size) {
    compiled.provider.size = options.image.size;
  }
  if (options.image?.quality) {
    compiled.provider.quality = options.image.quality;
  }
  const storedConstraints = mode === "regenerate" ? continuityConstraints : "";
  const runId = allocateRunId(projectId);
  const previousNode = tryReadWorkflowNode(projectId, current.id);
  const pageId = comicsPageId(sceneId, shotIndex, pageSize);

  let relativePath = "";
  try {
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
    relativePath = output.relativePath.trim();
    if (!relativePath) {
      throw new Error("Image adapter returned an empty path.");
    }

    const written = resolveProjectRelativeFile(projectId, relativePath);
    if (!projectFileExists(written)) {
      throw new Error("Image adapter did not write an image file.");
    }
  } catch (error) {
    const failed = persistShot(projectId, volumeId, chapterId, sceneId, current.id, { status: "failed" });
    writeWorkflowNode(
      projectId,
      nodeFromShot({
        sceneId,
        shot: failed,
        continuityConstraints: storedConstraints,
        previous: previousNode,
      }),
    );
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

function persistShot(
  projectId: string,
  volumeId: string,
  chapterId: string,
  sceneId: string,
  shotId: string,
  patch: Partial<Pick<StudioShot, "status" | "selected_image">>,
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
