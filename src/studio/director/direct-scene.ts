import "server-only";

import { planScenePages } from "../comics/plan-pages";
import { isStudioSlug, nextNumberedId, type StudioScene, type StudioShot, type StudioShotStatus } from "../domain";
import { StudioValidationError } from "../errors";
import { readContentState, readEntity, readScene, readStyle, replaceSceneShots } from "../fs";

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
  const title = scene.title.trim() || "the scene";
  const intent = scene.intent.trim() || `Establish ${title}`;
  const dialogue = scene.dialogue.lines
    .map((line) => line.text.trim())
    .filter(Boolean)
    .slice(0, 4);
  const actions = [
    `Establish ${title}: ${intent}`,
    ...(dialogue.length > 0 ? dialogue.map((line) => `Frame the confirmed line: ${line}`) : [`Hold the scene's central beat.`]),
  ].slice(0, MAX_DEFAULT_SHOTS);
  if (actions.length < 2) {
    actions.push(`Close ${title} while preserving the established intent.`);
  }
  return actions.map((action, index) => ({
    id: numberedShotId(index + 1),
    purpose: index === 0 ? `Establish ${title}` : index === actions.length - 1 ? `Close ${title}` : `Advance ${title}`,
    action,
    camera: ARTISTIC_CAMERAS[index % ARTISTIC_CAMERAS.length]!,
    continuity_from: index === 0 ? null : numberedShotId(index),
  }));
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
  const drafts = await llmDirector(scene, directorEvidence(projectId, volumeId, chapterId, scene));
  return persistDirectorDrafts(projectId, volumeId, chapterId, sceneId, scene, drafts);
}

function directorEvidence(
  projectId: string,
  volumeId: string,
  chapterId: string,
  scene: StudioScene,
): import("./llm-director").DirectorEvidence {
  const ids = [
    ...scene.characters,
    ...(scene.location ? [scene.location] : []),
    ...scene.props,
    ...scene.costumes,
  ];
  const entities = ids.flatMap((id) => {
    try {
      const entity = readEntity(projectId, id);
      return [
        {
          id: entity.id,
          kind: entity.kind,
          name: entity.name,
          description: entity.description,
          outfit: entity.states.default.outfit,
          condition: entity.states.default.condition,
        },
      ];
    } catch {
      return [];
    }
  });
  const state = readContentState(projectId, volumeId, chapterId, scene.id);
  const stateSummary =
    state?.patches
      .map((patch) =>
        [patch.entityId, patch.outfit, patch.condition, patch.note].filter((value) => Boolean(value)).join(" | "),
      )
      .filter(Boolean)
      .join("; ") ?? "";
  return {
    entities,
    stateSummary,
    timeSummary: `${volumeId} / ${chapterId}`,
    eventSummary: scene.intent,
  };
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
