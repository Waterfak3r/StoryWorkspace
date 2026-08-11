import "server-only";

import type { DatabaseSync } from "node:sqlite";
import {
  AI_LIMITS,
  aiContextSchema,
  type AiContext,
  type AiReferenceSummary,
} from "@/domain/ai";
import type { BibleEntry, Chapter, OutlineNode } from "@/domain/narrative";
import {
  getChapter,
  listBibleEntries,
  listChapters,
  listOutlineNodes,
} from "@/server/db/narrative";
import { NarrativeNotFoundError, NarrativeValidationError } from "@/server/db/narrative-errors";

export type ContextCollections = {
  bibleEntries: BibleEntry[];
  outlineNodes: OutlineNode[];
  chapters: Chapter[];
};

export type ResolvedAiContext = ContextCollections & {
  references: AiReferenceSummary[];
  referenceIds: string[];
  contextText: string;
  characterCount: number;
};

function comparePosition<T extends { position: number; id: string }>(left: T, right: T) {
  return left.position - right.position || left.id.localeCompare(right.id);
}

function requireProjectChapter(projectId: string, targetChapterId: string, chapters: Chapter[]) {
  const chapter = chapters.find((item) => item.id === targetChapterId);
  if (!chapter || chapter.projectId !== projectId) {
    throw new NarrativeNotFoundError("Chapter not found");
  }
  return chapter;
}

function selectReferences<T extends { id: string; projectId: string; position: number }>(
  ids: string[],
  records: T[],
  label: string,
) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const selected: T[] = [];
  for (const id of ids) {
    const record = byId.get(id);
    if (!record) {
      throw new NarrativeNotFoundError(`${label} reference not found`);
    }
    selected.push(record);
  }
  return selected.sort(comparePosition);
}

function contextLines(resolved: ContextCollections) {
  const lines: string[] = [];
  for (const entry of resolved.bibleEntries) {
    lines.push(`[bible] id=${entry.id} category=${entry.category} title=${entry.title}`);
    lines.push(entry.body);
  }
  for (const node of resolved.outlineNodes) {
    lines.push(`[outline] id=${node.id} kind=${node.kind} title=${node.title}`);
    lines.push(node.summary);
  }
  for (const chapter of resolved.chapters) {
    lines.push(`[chapter] id=${chapter.id} status=${chapter.status} title=${chapter.title}`);
    lines.push(chapter.summary);
    lines.push(chapter.body);
  }
  return lines;
}

export function contextTextFor(resolved: ContextCollections) {
  return contextLines(resolved).join("\n");
}

export function resolveAiContextFromCollections(
  projectId: string,
  targetChapterId: string,
  contextInput: AiContext,
  collections: ContextCollections,
): ResolvedAiContext {
  const context = aiContextSchema.parse(contextInput);
  requireProjectChapter(projectId, targetChapterId, collections.chapters);

  const projectBibleEntries = collections.bibleEntries.filter((entry) => entry.projectId === projectId);
  const projectOutlineNodes = collections.outlineNodes.filter((node) => node.projectId === projectId);
  const projectChapters = collections.chapters.filter((chapter) => chapter.projectId === projectId);
  const bibleEntries = selectReferences(context.bibleEntryIds, projectBibleEntries, "Bible entry");
  const outlineNodes = selectReferences(context.outlineNodeIds, projectOutlineNodes, "Outline node");
  const chapters = selectReferences(context.chapterIds, projectChapters, "Chapter");

  const references: AiReferenceSummary[] = [
    ...bibleEntries.map((entry) => ({ id: entry.id, group: "bible" as const, title: entry.title, subtype: entry.category })),
    ...outlineNodes.map((node) => ({ id: node.id, group: "outline" as const, title: node.title, subtype: node.kind })),
    ...chapters.map((chapter) => ({ id: chapter.id, group: "chapter" as const, title: chapter.title, subtype: chapter.status })),
  ];
  const selected = { bibleEntries, outlineNodes, chapters };
  const contextText = contextTextFor(selected);
  if (contextText.length > AI_LIMITS.resolvedContext) {
    throw new NarrativeValidationError(`Resolved story context exceeds the ${AI_LIMITS.resolvedContext} character limit`, ["context"]);
  }

  return {
    ...selected,
    references,
    referenceIds: references.map((reference) => reference.id),
    contextText,
    characterCount: contextText.length,
  };
}

export function resolveAiContext(
  projectId: string,
  targetChapterId: string,
  contextInput: AiContext,
  database?: DatabaseSync,
) {
  const collections: ContextCollections = {
    bibleEntries: listBibleEntries(projectId, database),
    outlineNodes: listOutlineNodes(projectId, database),
    chapters: listChapters(projectId, database),
  };
  const targetChapter = getChapter(targetChapterId, database);
  if (!targetChapter || targetChapter.projectId !== projectId) {
    throw new NarrativeNotFoundError("Chapter not found");
  }
  return resolveAiContextFromCollections(projectId, targetChapterId, contextInput, collections);
}
