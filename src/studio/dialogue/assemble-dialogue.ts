import {
  projectDialogueSchema,
  type StudioEntity,
  type StudioProjectDialogue,
} from "../domain";
import { readEntity, readProject, readScene, readTree } from "../fs";
import { assignDialogueToShots } from "./assign-dialogue";
import { extractAttributedDialogue } from "./extract-dialogue";

export function assembleProjectDialogue(projectId: string): StudioProjectDialogue {
  const project = readProject(projectId);
  const tree = readTree(projectId);
  const scenes: StudioProjectDialogue["scenes"] = [];
  let lineCount = 0;

  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      for (const sceneNode of chapter.scenes) {
        const scene = readScene(projectId, volume.id, chapter.id, sceneNode.id);
        const characters = scene.characters
          .map((id) => tryReadCharacter(projectId, id))
          .filter((entity): entity is { id: string; name: string } => entity !== null);
        const lines = extractAttributedDialogue(scene.script, characters);
        lineCount += lines.length;
        const assigned = assignDialogueToShots(lines, scene.shots);
        scenes.push({
          volumeId: volume.id,
          chapterId: chapter.id,
          sceneId: scene.id,
          title: scene.title,
          unassigned: scene.shots.length === 0 ? lines : [],
          shots: assigned.map((item) => {
            const shot = scene.shots.find((candidate) => candidate.id === item.shotId);
            return {
              shotId: item.shotId,
              action: shot?.action ?? "",
              purpose: shot?.purpose ?? "",
              lines: item.lines,
            };
          }),
        });
      }
    }
  }

  return projectDialogueSchema.parse({
    projectId: project.id,
    lineCount,
    scenes,
  });
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
