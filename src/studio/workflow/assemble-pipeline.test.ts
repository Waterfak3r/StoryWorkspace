import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { assemblePipelineGraph } from "./assemble-pipeline";
import type { StudioShot } from "../domain";
import { confirmSceneDialogue } from "../dialogue";
import { createProject, readScene, readTree, replaceSceneShots, updateScene } from "../fs";
import { ingestFixtureStory } from "../test-support/fixture-stories";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;

let workspaceRoot = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-pipeline-"));
  process.env.STORY_WORKSPACE_ROOT = workspaceRoot;
  delete process.env.STORY_WORKSPACE_DB_PATH;
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
  if (previousWorkspaceRoot === undefined) {
    delete process.env.STORY_WORKSPACE_ROOT;
  } else {
    process.env.STORY_WORKSPACE_ROOT = previousWorkspaceRoot;
  }
  if (previousDbPath === undefined) {
    delete process.env.STORY_WORKSPACE_DB_PATH;
  } else {
    process.env.STORY_WORKSPACE_DB_PATH = previousDbPath;
  }
});

describe("assemblePipelineGraph", () => {
  it("always emits the full chain and derives each stage from real project state", async () => {
    const empty = createProject({ title: "Empty Harbor" });
    const emptyGraph = assemblePipelineGraph(empty.id);
    expectLabels(emptyGraph);
    expectStatus(emptyGraph, {
      text: "pending",
      import: "pending",
      storyboard: "pending",
      dialogue: "pending",
      comics: "pending",
    });

    const { project } = await ingestFixtureStory("The Last Leaf", "last-leaf");
    const imported = assemblePipelineGraph(project.id);
    expectLabels(imported);
    expectStatus(imported, {
      text: "success",
      import: "success",
      storyboard: "pending",
      comics: "pending",
    });

    const pathIds = firstScenePath(project.id);
    const scene = readScene(project.id, pathIds.volumeId, pathIds.chapterId, pathIds.sceneId);
    replaceSceneShots(project.id, pathIds.volumeId, pathIds.chapterId, scene.id, [
      shot(scene.id, "shot-01", "Sue opens the curtain.", null),
      shot(scene.id, "shot-02", "Johnsy counts the leaves.", null),
    ]);
    const boarded = assemblePipelineGraph(project.id);
    expectLabels(boarded);
    expectStatus(boarded, {
      text: "success",
      import: "success",
      storyboard: "success",
      comics: "pending",
    });

    replaceSceneShots(project.id, pathIds.volumeId, pathIds.chapterId, scene.id, [
      shot(scene.id, "shot-01", "Sue opens the curtain.", "outputs/comics/pages/page-01-01/run-01.png"),
      shot(scene.id, "shot-02", "Johnsy counts the leaves.", "outputs/comics/pages/page-01-01/run-01.png"),
    ]);
    const finished = assemblePipelineGraph(project.id);
    expectLabels(finished);
    expectStatus(finished, {
      text: "success",
      import: "success",
      storyboard: "success",
      comics: "success",
    });

    updateScene(project.id, pathIds.volumeId, pathIds.chapterId, scene.id, {
      script: 'Sue: "The last leaf is still there."\nJohnsy: "I thought it would fall."',
      expectedUpdatedAt: readScene(project.id, pathIds.volumeId, pathIds.chapterId, scene.id).updatedAt,
    });
    const withScriptOnly = assemblePipelineGraph(project.id);
    expect(stage(withScriptOnly, "dialogue").status).toBe("pending");

    confirmSceneDialogue(project.id, pathIds.volumeId, pathIds.chapterId, scene.id);
    const confirmed = assemblePipelineGraph(project.id);
    expect(stage(confirmed, "dialogue").status).toBe("success");
  });
});

function firstScenePath(projectId: string) {
  const tree = readTree(projectId);
  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      for (const scene of chapter.scenes) {
        return { volumeId: volume.id, chapterId: chapter.id, sceneId: scene.id };
      }
    }
  }
  throw new Error("expected an ingested scene");
}

function expectLabels(graph: ReturnType<typeof assemblePipelineGraph>) {
  expect(graph.stages.map((item) => item.label)).toEqual([
    "文字生成",
    "导入阶段",
    "分镜阶段",
    "对话处理",
    "最终生成漫画",
  ]);
  expect(graph.edges).toEqual([
    { from: "text", to: "import" },
    { from: "import", to: "storyboard" },
    { from: "storyboard", to: "dialogue" },
    { from: "dialogue", to: "comics" },
  ]);
}

function expectStatus(
  graph: ReturnType<typeof assemblePipelineGraph>,
  expected: Partial<Record<"text" | "import" | "storyboard" | "dialogue" | "comics", "pending" | "success">>,
) {
  for (const [id, status] of Object.entries(expected)) {
    expect(stage(graph, id as "text").status).toBe(status);
  }
}

function stage(graph: ReturnType<typeof assemblePipelineGraph>, id: "text" | "import" | "storyboard" | "dialogue" | "comics") {
  const found = graph.stages.find((item) => item.id === id);
  if (!found) {
    throw new Error(`missing stage ${id}`);
  }
  return found;
}

function shot(sceneId: string, id: string, action: string, still: string | null): StudioShot {
  return {
    id,
    scene_id: sceneId,
    purpose: "beat",
    action,
    camera: "wide",
    continuity_from: null,
    status: still ? "success" : "pending",
    selected_image: still,
    updatedAt: new Date().toISOString(),
  };
}
