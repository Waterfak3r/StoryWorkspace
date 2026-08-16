import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { studioImageUrl } from "./api";
import { readSectionFromLocation } from "./sections";

describe("readSectionFromLocation", () => {
  it("defaults to overview when the section query is missing", () => {
    expect(readSectionFromLocation({ pathname: "/projects/p", search: "" })).toBe("overview");
  });

  it("reads a valid section query", () => {
    expect(readSectionFromLocation({ pathname: "/projects/p", search: "?section=story" })).toBe("story");
  });

  it("reads the story outline section", () => {
    expect(readSectionFromLocation({ pathname: "/projects/p", search: "?section=outline" })).toBe("outline");
  });

  it("falls back to overview for an unknown section", () => {
    expect(readSectionFromLocation({ pathname: "/projects/p", search: "?section=nope" })).toBe("overview");
  });

  it("defaults to overview when the section query is empty", () => {
    expect(readSectionFromLocation({ pathname: "/projects/p", search: "?section=" })).toBe("overview");
  });
});

describe("Outputs comics presentation", () => {
  it("renders four-panel pages from the comics HTTP read, not only a flat still list", () => {
    const source = readFileSync(path.join(__dirname, "OutputsPanel.tsx"), "utf8");
    expect(source).toContain("getStudioComics");
    expect(source).toContain("page.pageImage");
    expect(source).not.toContain("grid-cols-2");
    expect(source).toContain("panel.caption");
    expect(source).toContain('data-testid="comics-page"');
    expect(source).toContain("if (!active)");
    expect(source).not.toContain("getStudioWorkflow");
    const workspace = readFileSync(path.join(__dirname, "StudioWorkspace.tsx"), "utf8");
    expect(workspace).toContain("active={section === \"outputs\"}");
  });
});

describe("studioImageUrl", () => {
  it("builds a files URL for a project still and rejects other paths", () => {
    expect(studioImageUrl("the-last-leaf", "outputs/images/scene-02/shot-01/run-01.png")).toBe(
      "/api/studio/projects/the-last-leaf/files/outputs/images/scene-02/shot-01/run-01.png",
    );
    expect(studioImageUrl("the-last-leaf", "outputs/comics/pages/page-01/composed.png")).toBe(
      "/api/studio/projects/the-last-leaf/files/outputs/comics/pages/page-01/composed.png",
    );
    expect(studioImageUrl("the-last-leaf", "assets/images/character-01/ref-01.png")).toBe(
      "/api/studio/projects/the-last-leaf/files/assets/images/character-01/ref-01.png",
    );
    expect(studioImageUrl("the-last-leaf", "entities/characters/character-01.json")).toBe("");
  });
});
