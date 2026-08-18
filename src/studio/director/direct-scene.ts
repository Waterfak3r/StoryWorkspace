import "server-only";

import { planScenePages } from "../comics/plan-pages";
import { isStudioSlug, nextNumberedId, type StudioScene, type StudioShot, type StudioShotStatus } from "../domain";
import { StudioValidationError } from "../errors";
import { readScene, readStyle, replaceSceneShots } from "../fs";

export type DirectorShotDraft = {
  id?: string;
  purpose: string;
  action: string;
  camera: string;
  continuity_from?: string | null;
  status?: StudioShotStatus;
  selected_image?: string | null;
};

export type SceneDirector = (scene: StudioScene) => readonly DirectorShotDraft[];

export const ARTISTIC_CAMERAS = [
  "wide establishing shot, slow push-in",
  "medium two-shot, slight low angle",
  "close-up, hold on the face",
  "over-the-shoulder, shallow depth of field",
  "high angle, observational hold",
  "insert close-up, tight on the object",
  "dutch angle, tension hold",
] as const;

const CAMERA_LANGUAGE =
  /\b(wide|medium|close|close-up|closeup|angle|push|hold|insert|over-the-shoulder|ots|dutch|high|low|tracking|pan|tilt|crane)\b/i;

export function hasCameraLanguage(camera: string): boolean {
  return CAMERA_LANGUAGE.test(camera);
}

export function ensureArtisticCameras(drafts: readonly DirectorShotDraft[]): DirectorShotDraft[] {
  const cameras = drafts.map((draft) => draft.camera.trim().toLowerCase());
  const allSame = cameras.length > 0 && cameras.every((camera) => camera === cameras[0]);

  return drafts.map((draft, index) => {
    const camera = draft.camera.trim();
    if (camera && hasCameraLanguage(camera) && !allSame) {
      return { ...draft, camera };
    }
    const artistic = ARTISTIC_CAMERAS[index % ARTISTIC_CAMERAS.length]!;
    return {
      ...draft,
      camera: camera && hasCameraLanguage(camera) ? `${camera}; ${artistic}` : artistic,
    };
  });
}

export function defaultDirector(scene: StudioScene): DirectorShotDraft[] {
  const parts = splitSceneScript(scene.script);
  return parts.map((action, index, all) => {
    const first = index === 0;
    const last = index === all.length - 1;
    const preview = action.replace(/\s+/g, " ").slice(0, 56);
    return {
      id: numberedShotId(index + 1),
      purpose: first
        ? `Establish ${scene.title || "the scene"}`
        : last
          ? `Close ${scene.title || "the scene"}`
          : `Advance the plot: ${preview}`,
      action,
      camera: ARTISTIC_CAMERAS[index % ARTISTIC_CAMERAS.length]!,
      continuity_from: first ? null : numberedShotId(index),
    };
  });
}

export function directScene(
  projectId: string,
  volumeId: string,
  chapterId: string,
  sceneId: string,
  director: SceneDirector = defaultDirector,
): StudioScene {
  const scene = readScene(projectId, volumeId, chapterId, sceneId);
  if (scene.shots.length > 0) {
    return scene;
  }

  return persistDirectorDrafts(projectId, volumeId, chapterId, sceneId, scene, director(scene));
}

export async function directSceneAsync(
  projectId: string,
  volumeId: string,
  chapterId: string,
  sceneId: string,
  director?: SceneDirector,
): Promise<StudioScene> {
  const scene = readScene(projectId, volumeId, chapterId, sceneId);
  if (scene.shots.length > 0) {
    return scene;
  }

  if (director) {
    return persistDirectorDrafts(projectId, volumeId, chapterId, sceneId, scene, director(scene));
  }

  const { llmDirector } = await import("./llm-director");
  const drafts = await llmDirector(scene);
  return persistDirectorDrafts(projectId, volumeId, chapterId, sceneId, scene, drafts);
}

function persistDirectorDrafts(
  projectId: string,
  volumeId: string,
  chapterId: string,
  sceneId: string,
  scene: StudioScene,
  rawDrafts: readonly DirectorShotDraft[],
): StudioScene {
  const drafts = ensureArtisticCameras(rawDrafts);
  if (!Array.isArray(drafts) || drafts.length < 2) {
    throw new StudioValidationError("Director must produce at least two shots.");
  }

  const now = new Date().toISOString();
  const used = new Set<string>();
  const shots: StudioShot[] = [];

  for (const [index, draft] of drafts.entries()) {
    const id = assignShotId(draft.id, used);
    used.add(id);
    shots.push({
      id,
      scene_id: scene.id,
      purpose: draft.purpose,
      action: draft.action,
      camera: draft.camera,
      continuity_from: draft.continuity_from !== undefined ? draft.continuity_from : index === 0 ? null : shots[index - 1]!.id,
      status: draft.status ?? "pending",
      selected_image: draft.selected_image ?? null,
      pageId: "",
      updatedAt: now,
    });
  }

  const planned = planScenePages(scene.id, shots, readStyle(projectId).layout);
  const pageByShot = new Map(planned.map((item) => [item.shotId, item.pageId]));
  for (const shot of shots) {
    shot.pageId = pageByShot.get(shot.id) ?? "";
  }

  return replaceSceneShots(projectId, volumeId, chapterId, sceneId, shots);
}

function assignShotId(candidate: string | undefined, used: Set<string>): string {
  if (candidate && isStudioSlug(candidate) && !used.has(candidate)) {
    return candidate;
  }
  return nextNumberedId("shot", used);
}

function numberedShotId(n: number): string {
  return `shot-${String(n).padStart(2, "0")}`;
}

const MAX_DEFAULT_SHOTS = 6;

function splitSceneScript(script: string): string[] {
  const trimmed = script.trim();
  const paragraphs = trimmed.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const sentences = trimmed.split(/(?<=[.!?。！？])\s+/).map((part) => part.trim()).filter(Boolean);
  const parts = paragraphs.length >= 2 ? paragraphs : sentences.length >= 2 ? sentences : [];
  if (parts.length >= 2) {
    return chunkParts(parts, MAX_DEFAULT_SHOTS);
  }

  if (trimmed) {
    return [trimmed, "The moment holds."];
  }

  return ["The scene opens.", "The scene closes."];
}

function chunkParts(parts: readonly string[], maxChunks: number): string[] {
  if (parts.length <= maxChunks) {
    return [...parts];
  }
  const chunkSize = Math.ceil(parts.length / maxChunks);
  const chunks: string[] = [];
  for (let index = 0; index < parts.length; index += chunkSize) {
    chunks.push(parts.slice(index, index + chunkSize).join(" "));
  }
  return chunks;
}
