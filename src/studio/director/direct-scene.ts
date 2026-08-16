import "server-only";

import { isStudioSlug, nextNumberedId, type StudioScene, type StudioShot, type StudioShotStatus } from "../domain";
import { StudioValidationError } from "../errors";
import { readScene, replaceSceneShots } from "../fs";

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

export function defaultDirector(scene: StudioScene): DirectorShotDraft[] {
  const parts = splitSceneScript(scene.script);
  return parts.map((action, index, all) => {
    const first = index === 0;
    const last = index === all.length - 1;
    return {
      id: numberedShotId(index + 1),
      purpose: first ? "Establish the scene" : last ? "Close the scene" : "Continue the scene",
      action,
      camera: first ? "wide, slow push-in" : last ? "medium, hold" : "medium",
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

  const drafts = director(scene);
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
      updatedAt: now,
    });
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

function splitSceneScript(script: string): string[] {
  const trimmed = script.trim();
  const paragraphs = trimmed.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  if (paragraphs.length >= 2) {
    return paragraphs;
  }

  const sentences = trimmed.split(/(?<=[.!?。！？])\s+/).map((part) => part.trim()).filter(Boolean);
  if (sentences.length >= 2) {
    return sentences;
  }

  if (trimmed) {
    return [trimmed, "The moment holds."];
  }

  return ["The scene opens.", "The scene closes."];
}
