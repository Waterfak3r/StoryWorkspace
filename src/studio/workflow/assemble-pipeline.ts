import "server-only";

import {
  pipelineGraphSchema,
  type StudioPipelineGraph,
  type StudioPipelineStageId,
} from "../domain";
import { readProject, readScene, readTree } from "../fs";
import { listParseRuns } from "../parse";

export const PIPELINE_STAGE_ORDER: readonly { id: StudioPipelineStageId; label: string }[] = [
  { id: "text", label: "文字生成" },
  { id: "import", label: "导入阶段" },
  { id: "storyboard", label: "分镜阶段" },
  { id: "dialogue", label: "对话处理" },
  { id: "comics", label: "最终生成漫画" },
];

export function buildPipelineGraph(flags: {
  hasStoryText: boolean;
  importConfirmed: boolean;
  hasStoryboard: boolean;
  hasDialogue: boolean;
  hasComicsPage: boolean;
}): StudioPipelineGraph {
  const done: Record<StudioPipelineStageId, boolean> = {
    text: flags.hasStoryText,
    import: flags.importConfirmed,
    storyboard: flags.hasStoryboard,
    dialogue: flags.hasDialogue,
    comics: flags.hasComicsPage,
  };

  const stages = PIPELINE_STAGE_ORDER.map((stage) => ({
    id: stage.id,
    label: stage.label,
    status: done[stage.id] ? ("success" as const) : ("pending" as const),
    statusLabel: done[stage.id] ? ("成功" as const) : ("待跑" as const),
  }));

  return pipelineGraphSchema.parse({
    stages,
    edges: [
      { from: "text", to: "import" },
      { from: "import", to: "storyboard" },
      { from: "storyboard", to: "dialogue" },
      { from: "dialogue", to: "comics" },
    ],
  });
}

export function assemblePipelineGraph(projectId: string): StudioPipelineGraph {
  readProject(projectId);
  const tree = readTree(projectId);
  const parseRuns = listParseRuns(projectId);

  let hasStoryText = parseRuns.some((run) => run.sourceText.trim().length > 0);
  let importConfirmed = parseRuns.some((run) => run.status === "confirmed") || false;
  let hasStoryboard = false;
  let hasComicsPage = false;
  let storyboarded = 0;
  let confirmedDialogue = 0;

  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      for (const sceneNode of chapter.scenes) {
        const scene = readScene(projectId, volume.id, chapter.id, sceneNode.id);
        if (scene.script.trim()) {
          hasStoryText = true;
        }
        if (scene.provenance?.source === "parse") {
          importConfirmed = true;
        }
        if (scene.shots.length > 0) {
          hasStoryboard = true;
          storyboarded += 1;
          if (scene.dialogue.status === "confirmed") {
            confirmedDialogue += 1;
          }
        }
        if (scene.shots.some((shot) => (shot.selected_image ?? "").trim().length > 0)) {
          hasComicsPage = true;
        }
      }
    }
  }

  return buildPipelineGraph({
    hasStoryText,
    importConfirmed,
    hasStoryboard,
    hasDialogue: storyboarded > 0 && confirmedDialogue === storyboarded,
    hasComicsPage,
  });
}
