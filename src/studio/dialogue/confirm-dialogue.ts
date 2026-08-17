import "server-only";

import type {
  StudioAttributedSpeechLine,
  StudioEntity,
  StudioScene,
  StudioSceneDialogueLine,
} from "../domain";
import { readEntity, readScene, readTree, updateScene } from "../fs";
import { assignDialogueToShots } from "./assign-dialogue";
import { extractAttributedDialogue } from "./extract-dialogue";

export function confirmSceneDialogue(
  projectId: string,
  volumeId: string,
  chapterId: string,
  sceneId: string,
): StudioScene {
  const scene = readScene(projectId, volumeId, chapterId, sceneId);
  const characters = loadSceneCharacters(projectId, scene.characters);
  const extracted = extractAttributedDialogue(scene.script, characters);
  const lines = assignConfirmedLines(extracted, scene.shots);

  return updateScene(projectId, volumeId, chapterId, sceneId, {
    dialogue: {
      status: "confirmed",
      lines,
      confirmedAt: new Date().toISOString(),
    },
    expectedUpdatedAt: scene.updatedAt,
  });
}

export function confirmProjectDialogue(projectId: string): StudioScene[] {
  const tree = readTree(projectId);
  const scenes: StudioScene[] = [];

  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      for (const sceneNode of chapter.scenes) {
        const scene = readScene(projectId, volume.id, chapter.id, sceneNode.id);
        if (scene.shots.length === 0) {
          continue;
        }
        scenes.push(confirmSceneDialogue(projectId, volume.id, chapter.id, scene.id));
      }
    }
  }

  return scenes;
}

export function confirmedSpeechByShot(
  scene: StudioScene,
): Record<string, StudioAttributedSpeechLine[]> {
  const mapped: Record<string, StudioAttributedSpeechLine[]> = {};
  if (scene.dialogue.status !== "confirmed") {
    return mapped;
  }

  for (const line of scene.dialogue.lines) {
    if (!line.shotId) {
      continue;
    }
    (mapped[line.shotId] ??= []).push(toSpeechLine(line));
  }
  return mapped;
}

export function confirmedUnassignedLines(scene: StudioScene): StudioAttributedSpeechLine[] {
  if (scene.dialogue.status !== "confirmed") {
    return [];
  }
  return scene.dialogue.lines.filter((line) => line.shotId === null).map(toSpeechLine);
}

function assignConfirmedLines(
  extracted: readonly StudioAttributedSpeechLine[],
  shots: StudioScene["shots"],
): StudioSceneDialogueLine[] {
  if (shots.length === 0) {
    return extracted.map((line) => ({ ...line, shotId: null }));
  }

  return assignDialogueToShots(extracted, shots).flatMap((assignment) =>
    assignment.lines.map((line) => ({ ...line, shotId: assignment.shotId })),
  );
}

function toSpeechLine(line: StudioSceneDialogueLine): StudioAttributedSpeechLine {
  return {
    id: line.id,
    speaker: line.speaker,
    speakerId: line.speakerId,
    text: line.text,
  };
}

function loadSceneCharacters(projectId: string, ids: readonly string[]) {
  return ids
    .map((id) => tryReadCharacter(projectId, id))
    .filter((entity): entity is { id: string; name: string } => entity !== null);
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
