import { projectDialogueSchema, type StudioProjectDialogue } from "../domain";
import { readProject, readScene, readTree } from "../fs";
import { confirmedSpeechByShot, confirmedUnassignedLines } from "./confirm-dialogue";

export function assembleProjectDialogue(projectId: string): StudioProjectDialogue {
  const project = readProject(projectId);
  const tree = readTree(projectId);
  const scenes: StudioProjectDialogue["scenes"] = [];
  let lineCount = 0;

  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      for (const sceneNode of chapter.scenes) {
        const scene = readScene(projectId, volume.id, chapter.id, sceneNode.id);
        const confirmed = scene.dialogue.status === "confirmed";
        const byShot = confirmed ? confirmedSpeechByShot(scene) : {};
        const unassigned = confirmed ? confirmedUnassignedLines(scene) : [];
        const shotRows = scene.shots.map((shot) => ({
          shotId: shot.id,
          action: shot.action,
          purpose: shot.purpose,
          lines: byShot[shot.id] ?? [],
        }));
        lineCount += unassigned.length + shotRows.reduce((sum, shot) => sum + shot.lines.length, 0);
        scenes.push({
          volumeId: volume.id,
          chapterId: chapter.id,
          sceneId: scene.id,
          title: scene.title,
          unassigned,
          shots: shotRows,
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
