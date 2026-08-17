import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { StudioShot, StudioStoryTree } from "@/studio/domain";
import { findScenePathInTree, studioImageUrl } from "./api";
import { applyGeneratedPage, applyLockedShot, pageSelectedImage } from "./ShotBoard";

const shotBoardSource = readFileSync(path.join(__dirname, "ShotBoard.tsx"), "utf8");
const workflowSource = readFileSync(path.join(__dirname, "WorkflowPanel.tsx"), "utf8");

function shot(partial: Partial<StudioShot> & Pick<StudioShot, "id">): StudioShot {
  return {
    scene_id: "scene-01",
    purpose: "Establish the harbor",
    action: "Jill waits under a lantern.",
    camera: "wide establishing shot, slow push-in",
    continuity_from: null,
    status: "pending",
    selected_image: null,
    updatedAt: "2026-08-17T00:00:00.000Z",
    ...partial,
  };
}

describe("Story and Workflow generate/lock wiring", () => {
  it("wires ShotBoard generate and lock to the existing studio helpers", () => {
    expect(shotBoardSource).toContain("generateStudioShot");
    expect(shotBoardSource).toContain("lockStudioShot");
    expect(shotBoardSource).toContain("studioImageUrl");
    expect(shotBoardSource).toContain("Generate comic page");
    expect(shotBoardSource).toContain("Generating comic page");
    expect(shotBoardSource).toContain("<img");
    expect(shotBoardSource).toContain("selected_image");
    expect(shotBoardSource).toContain("pageImageUrl");
    expect(shotBoardSource).toMatch(/records\.length === 0[\s\S]*Generate comic page|Generate comic page[\s\S]*records\.length === 0/);
    expect(shotBoardSource).toContain('t("Lock")');
    expect(shotBoardSource).toContain('t("Unlock")');
    expect(shotBoardSource).toContain("pageLocked");
  });

  it("wires Workflow lock toggle to the same helper and disables Re-run while locked", () => {
    expect(workflowSource).toContain("lockStudioShot");
    expect(workflowSource).toContain("findScenePathInTree");
    expect(workflowSource).toContain('t("Lock")');
    expect(workflowSource).toContain('t("Unlock")');
    expect(workflowSource).toContain("disabled={node.locked || imageBusy || lockBusy}");
    expect(workflowSource).toContain("!node.locked");
  });

  it("binds the page preview to studioImageUrl(selected_image)", () => {
    const image = "outputs/comics/pages/page-01-01/run-01.png";
    const records = [
      shot({ id: "shot-01", status: "success", selected_image: image }),
      shot({ id: "shot-02", status: "success", selected_image: image }),
    ];
    expect(pageSelectedImage(records)).toBe(image);
    expect(studioImageUrl("harbor-night", image)).toBe(
      "/api/studio/projects/harbor-night/files/outputs/comics/pages/page-01-01/run-01.png",
    );
    expect(shotBoardSource).toContain("studioImageUrl(projectId, pageImage)");
  });

  it("merges the generated page shot and lock status through shipped helpers", () => {
    const pending = [
      shot({ id: "shot-01" }),
      shot({ id: "shot-02" }),
    ];
    const generated = shot({
      id: "shot-01",
      status: "success",
      selected_image: "outputs/comics/pages/page-01-01/run-02.png",
    });
    const afterGenerate = applyGeneratedPage(pending, generated);
    expect(afterGenerate[0]).toEqual(generated);
    expect(pageSelectedImage(afterGenerate)).toBe(generated.selected_image);

    const shared = applyGeneratedPage(
      [
        shot({ id: "shot-01", selected_image: generated.selected_image }),
        shot({ id: "shot-02", selected_image: generated.selected_image }),
      ],
      generated,
    );
    expect(shared[1]?.selected_image).toBe(generated.selected_image);
    expect(shared[1]?.status).toBe("success");

    const locked = applyLockedShot(afterGenerate, { ...generated, status: "locked" });
    expect(locked[0]?.status).toBe("locked");
    expect(locked[1]?.status).toBe("pending");
  });

  it("resolves a workflow scene to the lock route path", () => {
    const tree: StudioStoryTree = {
      volumes: [
        {
          id: "volume-01",
          title: "Volume 1",
          updatedAt: "2026-08-17T00:00:00.000Z",
          chapters: [
            {
              id: "chapter-01",
              title: "Chapter 1",
              updatedAt: "2026-08-17T00:00:00.000Z",
              scenes: [{ id: "scene-01", title: "Harbor", updatedAt: "2026-08-17T00:00:00.000Z" }],
            },
          ],
        },
      ],
    };
    expect(findScenePathInTree(tree, "scene-01")).toEqual({
      volumeId: "volume-01",
      chapterId: "chapter-01",
      sceneId: "scene-01",
    });
    expect(findScenePathInTree(tree, "scene-99")).toBeNull();
  });
});
