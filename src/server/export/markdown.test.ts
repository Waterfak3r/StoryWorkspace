import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { projectExportContentDisposition, renderProjectMarkdown, type ExportWorkspace } from "./markdown";

const timestamp = "2026-01-01T00:00:00.000Z";
const projectId = randomUUID();

function workspace(overrides: Partial<ExportWorkspace> = {}): ExportWorkspace {
  return {
    project: { id: projectId, title: "Export story", premise: "A premise", genre: "Drama", status: "active", createdAt: timestamp, updatedAt: timestamp },
    bibleEntries: [],
    outlineNodes: [],
    chapters: [],
    adaptations: [],
    ...overrides,
  };
}

function bibleEntry(category: "world" | "character" | "location" | "rule" | "theme", title: string, position: number) {
  return { id: randomUUID(), projectId, category, title, body: `${title}\r\nbody`, position, createdAt: timestamp, updatedAt: timestamp };
}

describe("deterministic Markdown export", () => {
  it("emits fixed section order, preorder outline, sorted records, LF, and omissions", () => {
    const rootId = randomUUID();
    const workspaceValue = workspace({
      project: { ...workspace().project, genre: "", premise: "" },
      bibleEntries: [bibleEntry("theme", "Theme", 3), bibleEntry("world", "World", 2), bibleEntry("world", "First", 1)],
      outlineNodes: [
        { id: randomUUID(), projectId, parentId: rootId, kind: "scene", title: "Child", summary: "", position: 0, createdAt: timestamp, updatedAt: timestamp },
        { id: rootId, projectId, parentId: null, kind: "story", title: "Root\nheading", summary: "", position: 5, createdAt: timestamp, updatedAt: timestamp },
      ],
      chapters: [{ id: randomUUID(), projectId, outlineNodeId: null, title: "Chapter", summary: "", body: "Chapter\r\nbody", position: 0, status: "draft", createdAt: timestamp, updatedAt: timestamp }],
      adaptations: [{ id: randomUUID(), projectId, format: "screenplay_scene", title: "Scene", body: "INT. ROOM\r\nAction", position: 0, sourceGenerationId: null, createdAt: timestamp, updatedAt: timestamp }],
    });

    const output = renderProjectMarkdown(workspaceValue);
    expect(output).not.toContain("\r");
    expect(output).toContain("# Export story\n\n## Story Bible");
    expect(output.indexOf("## Story Bible")).toBeLessThan(output.indexOf("## Outline"));
    expect(output.indexOf("## Outline")).toBeLessThan(output.indexOf("## Chapters"));
    expect(output.indexOf("## Chapters")).toBeLessThan(output.indexOf("## Adaptations"));
    expect(output.indexOf("#### First")).toBeLessThan(output.indexOf("#### World"));
    expect(output.indexOf("### Root heading")).toBeLessThan(output.indexOf("### Child"));
    expect(output).not.toContain("Genre:");
    expect(output).not.toContain("Premise:");
    expect(output.endsWith("\n")).toBe(true);

    const shuffled = {
      ...workspaceValue,
      bibleEntries: [...workspaceValue.bibleEntries].reverse(),
      outlineNodes: [...workspaceValue.outlineNodes].reverse(),
      chapters: [...workspaceValue.chapters].reverse(),
      adaptations: [...workspaceValue.adaptations].reverse(),
    };
    expect(renderProjectMarkdown(shuffled)).toBe(output);
  });

  it("is byte-identical for the same stored state", () => {
    const value = workspace({ adaptations: [{ id: randomUUID(), projectId, format: "screenplay_scene", title: "Stable", body: "Body", position: 1, sourceGenerationId: null, createdAt: timestamp, updatedAt: timestamp }] });
    expect(renderProjectMarkdown(value)).toBe(renderProjectMarkdown(value));
  });

  it("keeps orphan and cyclic outline data finite and deterministic", () => {
    const cycleA = "11111111-1111-4111-8111-111111111111";
    const cycleB = "22222222-2222-4222-8222-222222222222";
    const orphan = "33333333-3333-4333-8333-333333333333";
    const nodes = [
      { id: cycleA, projectId, parentId: cycleB, kind: "scene" as const, title: "Cycle A", summary: "", position: 1, createdAt: timestamp, updatedAt: timestamp },
      { id: cycleB, projectId, parentId: cycleA, kind: "act" as const, title: "Cycle B", summary: "", position: 0, createdAt: timestamp, updatedAt: timestamp },
      { id: orphan, projectId, parentId: randomUUID(), kind: "story" as const, title: "Orphan", summary: "", position: 2, createdAt: timestamp, updatedAt: timestamp },
    ];
    const first = renderProjectMarkdown(workspace({ outlineNodes: nodes }));
    const second = renderProjectMarkdown(workspace({ outlineNodes: [...nodes].reverse() }));
    expect(second).toBe(first);
    expect(first.match(/### (Cycle A|Cycle B|Orphan)/g)).toHaveLength(3);
  });

  it("builds safe fallback and encoded UTF-8 attachment names", () => {
    const disposition = projectExportContentDisposition("夜\r\nstory / draft");
    expect(disposition).toContain('filename="story-workspace-export.md"');
    expect(disposition).toContain("filename*=UTF-8''");
    expect(disposition).not.toContain("\r");
    expect(disposition).not.toContain("\n");
    expect(disposition).not.toContain("夜");
  });
});
