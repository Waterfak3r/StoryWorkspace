import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { GET as getComics } from "@/app/api/studio/projects/[projectId]/comics/route";
import { assembleComicsBook, paginateComicsStills } from "./assemble-pages";
import type { StudioShot } from "../domain";
import {
  createChapter,
  createProject,
  createScene,
  createVolume,
  replaceSceneShots,
} from "../fs";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;

let workspaceRoot = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-comics-"));
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

describe("paginateComicsStills", () => {
  it("groups frames into pages of at most four panels", () => {
    const frames = [1, 2, 3, 4, 5].map((n) => ({
      volumeId: "volume-01",
      chapterId: "chapter-01",
      sceneId: "scene-01",
      shotId: `shot-0${n}`,
      stillPath: `outputs/images/scene-01/shot-0${n}/run-01.png`,
      caption: `Action ${n}`,
    }));

    const pages = paginateComicsStills(frames);
    expect(pages).toHaveLength(2);
    expect(pages[0]?.panels).toHaveLength(4);
    expect(pages[1]?.panels).toHaveLength(1);
    expect(pages[1]?.panels[0]?.shotId).toBe("shot-05");
  });
});

describe("assembleComicsBook", () => {
  it("returns an empty page list when the project has no selected stills", () => {
    const project = createProject({ title: "Empty Harbor" });
    const book = assembleComicsBook(project.id);

    expect(book.projectId).toBe(project.id);
    expect(book.title).toBe("Empty Harbor");
    expect(book.pages).toEqual([]);
  });

  it("assembles three stills into one page and skips shots without a still", () => {
    const project = createProject({ title: "Three Stills" });
    replaceSceneShots(project.id, "volume-01", "chapter-01", "scene-01", [
      stillShot("scene-01", "shot-01", "Sue opens the curtain.", "outputs/images/scene-01/shot-01/run-01.png"),
      stillShot("scene-01", "shot-02", "No still for this beat.", null),
      stillShot("scene-01", "shot-03", "Johnsy stares at the leaf.", "outputs/images/scene-01/shot-03/run-01.png"),
      stillShot("scene-01", "shot-04", "Sue hugs Johnsy.", "outputs/images/scene-01/shot-04/run-01.png"),
    ]);

    const book = assembleComicsBook(project.id);
    expect(book.pages).toHaveLength(1);
    expect(book.pages[0]?.pageImage).toBe("outputs/images/scene-01/shot-01/run-01.png");
    expect(book.pages[0]?.panels).toHaveLength(3);
    expect(book.pages[0]?.panels.map((panel) => panel.shotId)).toEqual(["shot-01", "shot-03", "shot-04"]);
    expect(book.pages[0]?.panels.map((panel) => panel.caption)).toEqual([
      "Sue opens the curtain.",
      "Johnsy stares at the leaf.",
      "Sue hugs Johnsy.",
    ]);
    expect(book.pages[0]?.panels.map((panel) => panel.stillPath)).toEqual([
      "outputs/images/scene-01/shot-01/run-01.png",
      "outputs/images/scene-01/shot-03/run-01.png",
      "outputs/images/scene-01/shot-04/run-01.png",
    ]);
  });

  it("walks volume, chapter, and scene order and splits five stills into two pages", () => {
    const project = createProject({ title: "Five Stills" });
    replaceSceneShots(project.id, "volume-01", "chapter-01", "scene-01", [
      stillShot("scene-01", "shot-01", "A waits.", "outputs/images/scene-01/shot-01/run-01.png"),
      stillShot("scene-01", "shot-skip", "Skip me.", null),
      stillShot("scene-01", "shot-02", "B turns.", "outputs/images/scene-01/shot-02/run-01.png"),
    ]);

    createChapter(project.id, "volume-01", { id: "chapter-02", title: "Later" });
    createScene(project.id, "volume-01", "chapter-02", { id: "scene-01", title: "Later scene" });
    replaceSceneShots(project.id, "volume-01", "chapter-02", "scene-01", [
      stillShot("scene-01", "shot-01", "C arrives.", "outputs/images/scene-01/shot-01/run-02.png"),
    ]);

    createVolume(project.id, { id: "volume-02", title: "Volume two" });
    createChapter(project.id, "volume-02", { id: "chapter-01", title: "Next volume" });
    createScene(project.id, "volume-02", "chapter-01", { id: "scene-01", title: "Next scene" });
    replaceSceneShots(project.id, "volume-02", "chapter-01", "scene-01", [
      stillShot("scene-01", "shot-01", "D looks back.", "outputs/images/scene-01/shot-01/run-03.png"),
      stillShot("scene-01", "shot-02", "E closes the door.", "outputs/images/scene-01/shot-02/run-03.png"),
    ]);

    const book = assembleComicsBook(project.id);
    expect(book.pages).toHaveLength(2);
    expect(book.pages[0]?.panels).toHaveLength(4);
    expect(book.pages[1]?.panels).toHaveLength(1);

    const panels = book.pages.flatMap((page) => page.panels);
    expect(panels.map((panel) => panel.caption)).toEqual([
      "A waits.",
      "B turns.",
      "C arrives.",
      "D looks back.",
      "E closes the door.",
    ]);
    expect(panels.map((panel) => `${panel.volumeId}/${panel.chapterId}/${panel.shotId}`)).toEqual([
      "volume-01/chapter-01/shot-01",
      "volume-01/chapter-01/shot-02",
      "volume-01/chapter-02/shot-01",
      "volume-02/chapter-01/shot-01",
      "volume-02/chapter-01/shot-02",
    ]);
    expect(panels.every((panel) => panel.stillPath.startsWith("outputs/images/"))).toBe(true);
  });

  it("assembles last-leaf climax stills as one three-panel page", () => {
    const project = createProject({ title: "The Last Leaf", id: "the-last-leaf" });
    const climax = createScene(project.id, "volume-01", "chapter-01", {
      id: "scene-06",
      title: "The last leaf stays",
    });
    replaceSceneShots(project.id, "volume-01", "chapter-01", climax.id, [
      stillShot("scene-06", "shot-16", "No still.", null),
      stillShot(
        "scene-06",
        "shot-17",
        "Johnsy continues watching the leaf, then says she wants to live and paint again.",
        "outputs/images/scene-06/shot-17/run-04.png",
      ),
      stillShot("scene-06", "shot-18", "Sue hugs Johnsy, expressing joy.", "outputs/images/scene-06/shot-18/run-05.png"),
      stillShot("scene-06", "shot-19", "The doctor examines Johnsy.", null),
      stillShot(
        "scene-06",
        "shot-23",
        "The painted leaf remains on the wall, a testament to Behrman's sacrifice.",
        "outputs/images/scene-06/shot-23/run-03.png",
      ),
    ]);

    const book = assembleComicsBook(project.id);
    expect(book.pages).toHaveLength(1);
    expect(book.pages[0]?.panels.map((panel) => panel.shotId)).toEqual(["shot-17", "shot-18", "shot-23"]);
    expect(book.pages[0]?.panels[0]?.caption).toBe(
      "Johnsy continues watching the leaf, then says she wants to live and paint again.",
    );
  });

  it.skipIf(!existsSync(path.resolve(__dirname, "../../../.data/projects/the-last-leaf/project.json")))(
    "reads on-disk the-last-leaf stills into one three-panel page when present",
    () => {
    const repoWorkspace = path.resolve(__dirname, "../../../.data/projects");

    process.env.STORY_WORKSPACE_ROOT = repoWorkspace;
    const book = assembleComicsBook("the-last-leaf");
    expect(book.pages).toHaveLength(1);
    expect(book.pages[0]?.pageImage).toBe("outputs/comics/pages/page-01/composed.png");
    expect(book.pages[0]?.panels).toHaveLength(3);
    expect(book.pages[0]?.panels.map((panel) => panel.shotId)).toEqual(["shot-17", "shot-18", "shot-23"]);
    expect(book.pages[0]?.panels.map((panel) => panel.caption)).toEqual([
      "Johnsy continues watching the leaf, then says she wants to live and paint again.",
      "Sue hugs Johnsy, expressing joy.",
      "The painted leaf remains on the wall, a testament to Behrman's sacrifice.",
    ]);
  });
});

describe("GET /api/studio/projects/:projectId/comics", () => {
  it("returns an empty book for a project with no stills", async () => {
    const project = createProject({ title: "Harbor Night" });
    const response = await getComics(
      new Request(`http://localhost/api/studio/projects/${project.id}/comics`),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.book.pages).toEqual([]);
    expect(body.data.book.projectId).toBe(project.id);
  });

  it("returns pages whose still paths match seeded selected_image values", async () => {
    const project = createProject({ title: "Harbor Night" });
    const stills = [
      "outputs/images/scene-01/shot-01/run-01.png",
      "outputs/images/scene-01/shot-02/run-01.png",
      "outputs/images/scene-01/shot-03/run-01.png",
    ];
    replaceSceneShots(project.id, "volume-01", "chapter-01", "scene-01", [
      stillShot("scene-01", "shot-01", "Jill waits on the pier.", stills[0]!),
      stillShot("scene-01", "shot-02", "A lantern swings.", stills[1]!),
      stillShot("scene-01", "shot-03", "The harbor goes dark.", stills[2]!),
    ]);

    const response = await getComics(
      new Request(`http://localhost/api/studio/projects/${project.id}/comics`),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.book.pages).toHaveLength(1);
    expect(body.data.book.pages[0]?.panels).toHaveLength(3);
    expect(body.data.book.pages[0]?.panels.map((panel: { stillPath: string }) => panel.stillPath)).toEqual(stills);
    expect(body.data.book.pages[0]?.panels.map((panel: { caption: string }) => panel.caption)).toEqual([
      "Jill waits on the pier.",
      "A lantern swings.",
      "The harbor goes dark.",
    ]);
  });
});

function stillShot(sceneId: string, id: string, action: string, still: string | null): StudioShot {
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
