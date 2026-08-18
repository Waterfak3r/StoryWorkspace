import { projectDialogueSchema, type StudioProjectDialogue } from "../domain";
import { readProject, readScene, readTree } from "../fs";
import { timelineEventId } from "../outline/build-timeline";
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
        const eventId = timelineEventId({
          volumeId: volume.id,
          chapterId: chapter.id,
          sceneId: scene.id,
        });
        const confirmed = scene.dialogue.status === "confirmed";
        const byShot = confirmed ? confirmedSpeechByShot(scene) : {};
        const unassigned = confirmed
          ? confirmedUnassignedLines(scene).map((line) => withEvent(line, eventId))
          : [];
        const shotRows = scene.shots.map((shot) => ({
          shotId: shot.id,
          action: shot.action,
          purpose: shot.purpose,
          lines: (byShot[shot.id] ?? []).map((line) => withEvent(line, eventId)),
        }));
        lineCount += unassigned.length + shotRows.reduce((sum, shot) => sum + shot.lines.length, 0);
        scenes.push({
          volumeId: volume.id,
          chapterId: chapter.id,
          sceneId: scene.id,
          title: scene.title,
          eventId,
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

function withEvent<T extends { eventId?: string }>(line: T, eventId: string): T {
  return { ...line, eventId: line.eventId || eventId };
}
