import "server-only";

import type { Adaptation } from "@/domain/adaptation";
import type { BibleEntry, Chapter, OutlineNode } from "@/domain/narrative";
import type { Project } from "@/domain/project";

export type ExportWorkspace = {
  project: Project;
  bibleEntries: BibleEntry[];
  outlineNodes: OutlineNode[];
  chapters: Chapter[];
  adaptations: Adaptation[];
};

const BIBLE_CATEGORY_ORDER = ["world", "character", "location", "rule", "theme"] as const;

function comparePositionId(left: { position: number; id: string }, right: { position: number; id: string }) {
  return left.position - right.position || left.id.localeCompare(right.id);
}

export function normalizeExportLineEndings(value: string) {
  return value.replace(/\r\n?/g, "\n");
}

export function normalizeExportHeading(value: string) {
  return normalizeExportLineEndings(value).replace(/\s+/g, " ").trim();
}

function appendOptionalSingleLine(lines: string[], label: string, value: string) {
  const normalized = normalizeExportHeading(value);
  if (normalized) {
    lines.push(`${label}: ${normalized}`);
  }
}

function appendBody(lines: string[], body: string) {
  const normalized = normalizeExportLineEndings(body);
  if (normalized.length > 0) {
    lines.push(normalized);
  }
}

function outlinePreorder(nodes: OutlineNode[]) {
  const sorted = [...nodes].sort(comparePositionId);
  const ids = new Set(sorted.map((node) => node.id));
  const children = new Map<string | null, OutlineNode[]>();

  for (const node of sorted) {
    const parentId = node.parentId && ids.has(node.parentId) ? node.parentId : null;
    const siblings = children.get(parentId) ?? [];
    siblings.push(node);
    children.set(parentId, siblings);
  }

  for (const siblings of children.values()) {
    siblings.sort(comparePositionId);
  }

  const ordered: OutlineNode[] = [];
  const visited = new Set<string>();
  const visit = (node: OutlineNode) => {
    if (visited.has(node.id)) {
      return;
    }
    visited.add(node.id);
    ordered.push(node);
    for (const child of children.get(node.id) ?? []) {
      visit(child);
    }
  };

  for (const root of children.get(null) ?? []) {
    visit(root);
  }
  for (const node of sorted) {
    visit(node);
  }

  return ordered;
}

function renderBible(entries: BibleEntry[]) {
  if (entries.length === 0) {
    return null;
  }
  const lines = ["## Story Bible"];
  for (const category of BIBLE_CATEGORY_ORDER) {
    const categoryEntries = entries
      .filter((entry) => entry.category === category)
      .sort(comparePositionId);
    if (categoryEntries.length === 0) {
      continue;
    }
    const categoryHeading = `${category.slice(0, 1).toUpperCase()}${category.slice(1)}`;
    lines.push("", `### ${normalizeExportHeading(categoryHeading)}`);
    for (const entry of categoryEntries) {
      lines.push("", `#### ${normalizeExportHeading(entry.title)}`);
      appendBody(lines, entry.body);
    }
  }
  return lines.join("\n");
}

function renderOutline(nodes: OutlineNode[]) {
  if (nodes.length === 0) {
    return null;
  }
  const lines = ["## Outline"];
  for (const node of outlinePreorder(nodes)) {
    lines.push("", `### ${normalizeExportHeading(node.title)}`);
    appendOptionalSingleLine(lines, "Kind", node.kind);
    appendOptionalSingleLine(lines, "Summary", node.summary);
  }
  return lines.join("\n");
}

function renderChapters(chapters: Chapter[]) {
  if (chapters.length === 0) {
    return null;
  }
  const lines = ["## Chapters"];
  for (const chapter of [...chapters].sort(comparePositionId)) {
    lines.push("", `### ${normalizeExportHeading(chapter.title)}`);
    appendOptionalSingleLine(lines, "Status", chapter.status);
    appendOptionalSingleLine(lines, "Summary", chapter.summary);
    appendBody(lines, chapter.body);
  }
  return lines.join("\n");
}

function renderAdaptations(adaptations: Adaptation[]) {
  if (adaptations.length === 0) {
    return null;
  }
  const lines = ["## Adaptations"];
  for (const adaptation of [...adaptations].sort(comparePositionId)) {
    lines.push("", `### ${normalizeExportHeading(adaptation.title)}`);
    appendOptionalSingleLine(lines, "Format", adaptation.format);
    appendBody(lines, adaptation.body);
  }
  return lines.join("\n");
}

export function renderProjectMarkdown(workspace: ExportWorkspace) {
  const metadata = [`# ${normalizeExportHeading(workspace.project.title)}`];
  appendOptionalSingleLine(metadata, "Genre", workspace.project.genre);
  appendOptionalSingleLine(metadata, "Premise", workspace.project.premise);

  const sections = [
    metadata.join("\n"),
    renderBible(workspace.bibleEntries),
    renderOutline(workspace.outlineNodes),
    renderChapters(workspace.chapters),
    renderAdaptations(workspace.adaptations),
  ].filter((section): section is string => section !== null);

  return `${sections.join("\n\n")}\n`;
}

function encodeRfc5987(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function projectExportContentDisposition(projectTitle: string) {
  const normalizedTitle = normalizeExportHeading(projectTitle).replace(/[\r\n]/g, "").trim() || "story-workspace";
  const filename = `${normalizedTitle}.md`;
  return `attachment; filename="story-workspace-export.md"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}
