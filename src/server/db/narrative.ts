import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  aiAcceptInputSchema,
  aiGenerationSchema,
  createAiGenerationInputSchema,
  type AiGeneration,
  type CreateAiGenerationInput,
} from "@/domain/ai";
import {
  bibleEntrySchema,
  chapterSchema,
  chapterVersionSchema,
  contextReferenceIdsSchema,
  createBibleEntryInputSchema,
  createChapterInputSchema,
  createChapterVersionInputSchema,
  createOutlineNodeInputSchema,
  outlineNodeSchema,
  outlineOrderInputSchema,
  updateBibleEntryInputSchema,
  updateChapterInputSchema,
  updateOutlineNodeInputSchema,
  type BibleEntry,
  type Chapter,
  type ChapterVersion,
  type CreateBibleEntryInput,
  type CreateChapterInput,
  type CreateChapterVersionInput,
  type CreateOutlineNodeInput,
  type OutlineNode,
  type OutlineOrderInput,
  type UpdateBibleEntryInput,
  type UpdateChapterInput,
  type UpdateOutlineNodeInput,
} from "@/domain/narrative";
import {
  adaptationSchema,
  createAdaptationInputSchema,
  updateAdaptationInputSchema,
  type Adaptation,
  type CreateAdaptationInput,
  type UpdateAdaptationInput,
} from "@/domain/adaptation";
import { projectSchema, type Project } from "@/domain/project";
import { getDatabase } from "./connection";
import {
  ChapterEditConflictError,
  AiGenerationAlreadyAcceptedError,
  NarrativeDataIntegrityError,
  NarrativeNotFoundError,
  NarrativeValidationError,
  AdaptationEditConflictError,
  AiGenerationAlreadyConsumedError,
} from "./narrative-errors";

type SqliteParameters = Record<string, string | number | null>;

type BibleEntryRow = {
  id: string;
  project_id: string;
  category: BibleEntry["category"];
  title: string;
  body: string;
  position: number;
  created_at: string;
  updated_at: string;
};

type OutlineNodeRow = {
  id: string;
  project_id: string;
  parent_id: string | null;
  kind: OutlineNode["kind"];
  title: string;
  summary: string;
  position: number;
  created_at: string;
  updated_at: string;
};

type ChapterRow = {
  id: string;
  project_id: string;
  outline_node_id: string | null;
  title: string;
  summary: string;
  body: string;
  position: number;
  status: Chapter["status"];
  created_at: string;
  updated_at: string;
};

type ChapterVersionRow = {
  id: string;
  chapter_id: string;
  body: string;
  source: ChapterVersion["source"];
  ai_action: string | null;
  instruction: string | null;
  context_reference_ids: string | null;
  created_at: string;
};

type AiGenerationRow = {
  id: string;
  project_id: string;
  target_chapter_id: string;
  action: AiGeneration["action"];
  instruction: string;
  context_reference_ids: string;
  generated_markdown: string;
  created_at: string;
  accepted_version_id: string | null;
};

type AdaptationRow = {
  id: string;
  project_id: string;
  format: Adaptation["format"];
  title: string;
  body: string;
  position: number;
  source_generation_id: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectRow = {
  id: string;
  title: string;
  premise: string;
  genre: string;
  status: Project["status"];
  created_at: string;
  updated_at: string;
};

function resolveDatabase(database?: DatabaseSync) {
  return database ?? getDatabase();
}

function now() {
  return new Date().toISOString();
}

function nextRevisionTimestamp(currentUpdatedAt: string) {
  const currentMillis = Date.parse(currentUpdatedAt);
  const candidate = now();
  const candidateMillis = Date.parse(candidate);

  if (Number.isFinite(currentMillis) && candidateMillis > currentMillis) {
    return candidate;
  }

  return Number.isFinite(currentMillis)
    ? new Date(currentMillis + 1).toISOString()
    : candidate;
}

function toProject(row: ProjectRow): Project {
  return projectSchema.parse({
    id: row.id,
    title: row.title,
    premise: row.premise,
    genre: row.genre,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toBibleEntry(row: BibleEntryRow): BibleEntry {
  return bibleEntrySchema.parse({
    id: row.id,
    projectId: row.project_id,
    category: row.category,
    title: row.title,
    body: row.body,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toOutlineNode(row: OutlineNodeRow): OutlineNode {
  return outlineNodeSchema.parse({
    id: row.id,
    projectId: row.project_id,
    parentId: row.parent_id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toChapter(row: ChapterRow): Chapter {
  return chapterSchema.parse({
    id: row.id,
    projectId: row.project_id,
    outlineNodeId: row.outline_node_id,
    title: row.title,
    summary: row.summary,
    body: row.body,
    position: row.position,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function parseContextReferenceIds(value: string | null, versionId: string) {
  if (value === null) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new NarrativeDataIntegrityError(`Invalid context reference IDs for chapter version ${versionId}`);
  }

  const result = contextReferenceIdsSchema.safeParse(parsed);
  if (!result.success) {
    throw new NarrativeDataIntegrityError(`Invalid context reference IDs for chapter version ${versionId}`);
  }

  return result.data;
}

function toChapterVersion(row: ChapterVersionRow): ChapterVersion {
  return chapterVersionSchema.parse({
    id: row.id,
    chapterId: row.chapter_id,
    body: row.body,
    source: row.source,
    aiAction: row.ai_action,
    instruction: row.instruction,
    contextReferenceIds: parseContextReferenceIds(row.context_reference_ids, row.id),
    createdAt: row.created_at,
  });
}

function parseStoredReferenceIds(value: string, generationId: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new NarrativeDataIntegrityError(`Invalid context reference IDs for AI generation ${generationId}`);
  }
  const result = contextReferenceIdsSchema.safeParse(parsed);
  if (!result.success) {
    throw new NarrativeDataIntegrityError(`Invalid context reference IDs for AI generation ${generationId}`);
  }
  return result.data;
}

function toAiGeneration(row: AiGenerationRow): AiGeneration {
  return aiGenerationSchema.parse({
    id: row.id,
    projectId: row.project_id,
    targetChapterId: row.target_chapter_id,
    action: row.action,
    instruction: row.instruction,
    contextReferenceIds: parseStoredReferenceIds(row.context_reference_ids, row.id),
    generatedMarkdown: row.generated_markdown,
    createdAt: row.created_at,
    acceptedVersionId: row.accepted_version_id,
  });
}

function toAdaptation(row: AdaptationRow): Adaptation {
  return adaptationSchema.parse({
    id: row.id,
    projectId: row.project_id,
    format: row.format,
    title: row.title,
    body: row.body,
    position: row.position,
    sourceGenerationId: row.source_generation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function getProjectWithDatabase(projectId: string, database: DatabaseSync) {
  const row = database
    .prepare("SELECT id, title, premise, genre, status, created_at, updated_at FROM projects WHERE id = :id")
    .get({ id: projectId }) as unknown as ProjectRow | undefined;

  return row ? toProject(row) : null;
}

function requireProject(projectId: string, database: DatabaseSync) {
  const project = getProjectWithDatabase(projectId, database);
  if (!project) {
    throw new NarrativeNotFoundError("Project not found");
  }
  return project;
}

function nextPosition(projectId: string, table: "bible_entries" | "outline_nodes" | "chapters" | "adaptations", database: DatabaseSync) {
  const row = database
    .prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM ${table} WHERE project_id = :projectId`)
    .get({ projectId }) as { next_position?: number } | undefined;

  return row?.next_position ?? 0;
}

function getBibleEntryWithDatabase(entryId: string, database: DatabaseSync) {
  const row = database
    .prepare("SELECT id, project_id, category, title, body, position, created_at, updated_at FROM bible_entries WHERE id = :id")
    .get({ id: entryId }) as unknown as BibleEntryRow | undefined;
  return row ? toBibleEntry(row) : null;
}

export function listBibleEntries(projectId: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  requireProject(projectId, db);
  const rows = db
    .prepare("SELECT id, project_id, category, title, body, position, created_at, updated_at FROM bible_entries WHERE project_id = :projectId ORDER BY position ASC, id ASC")
    .all({ projectId });
  return (rows as unknown as BibleEntryRow[]).map(toBibleEntry);
}

export function getBibleEntry(entryId: string, database?: DatabaseSync) {
  return getBibleEntryWithDatabase(entryId, resolveDatabase(database));
}

export function createBibleEntry(projectId: string, input: CreateBibleEntryInput, database?: DatabaseSync) {
  const values = createBibleEntryInputSchema.parse(input);
  const db = resolveDatabase(database);
  requireProject(projectId, db);
  const id = randomUUID();
  const timestamp = now();
  const position = values.position ?? nextPosition(projectId, "bible_entries", db);

  db.prepare("INSERT INTO bible_entries (id, project_id, category, title, body, position, created_at, updated_at) VALUES (:id, :projectId, :category, :title, :body, :position, :createdAt, :updatedAt)")
    .run({ id, projectId, category: values.category, title: values.title, body: values.body, position, createdAt: timestamp, updatedAt: timestamp });

  return getBibleEntryWithDatabase(id, db) as BibleEntry;
}

export function updateBibleEntry(entryId: string, input: UpdateBibleEntryInput, database?: DatabaseSync) {
  const values = updateBibleEntryInputSchema.parse(input);
  const db = resolveDatabase(database);
  const current = getBibleEntryWithDatabase(entryId, db);
  if (!current) {
    return null;
  }

  const fields: string[] = [];
  const parameters: SqliteParameters = { id: entryId, updatedAt: now() };
  if (values.category !== undefined) {
    fields.push("category = :category");
    parameters.category = values.category;
  }
  if (values.title !== undefined) {
    fields.push("title = :title");
    parameters.title = values.title;
  }
  if (values.body !== undefined) {
    fields.push("body = :body");
    parameters.body = values.body;
  }
  if (values.position !== undefined) {
    fields.push("position = :position");
    parameters.position = values.position;
  }
  fields.push("updated_at = :updatedAt");

  db.prepare(`UPDATE bible_entries SET ${fields.join(", ")} WHERE id = :id`).run(parameters);
  return getBibleEntryWithDatabase(entryId, db);
}

export function deleteBibleEntry(entryId: string, database?: DatabaseSync) {
  const result = resolveDatabase(database).prepare("DELETE FROM bible_entries WHERE id = :id").run({ id: entryId });
  return result.changes > 0;
}

function getOutlineNodeWithDatabase(nodeId: string, database: DatabaseSync) {
  const row = database
    .prepare("SELECT id, project_id, parent_id, kind, title, summary, position, created_at, updated_at FROM outline_nodes WHERE id = :id")
    .get({ id: nodeId }) as unknown as OutlineNodeRow | undefined;
  return row ? toOutlineNode(row) : null;
}

export function listOutlineNodes(projectId: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  requireProject(projectId, db);
  const rows = db
    .prepare("SELECT id, project_id, parent_id, kind, title, summary, position, created_at, updated_at FROM outline_nodes WHERE project_id = :projectId ORDER BY position ASC, id ASC")
    .all({ projectId });
  return (rows as unknown as OutlineNodeRow[]).map(toOutlineNode);
}

export function getOutlineNode(nodeId: string, database?: DatabaseSync) {
  return getOutlineNodeWithDatabase(nodeId, resolveDatabase(database));
}

function validateOutlineParent(projectId: string, parentId: string | null, nodeId: string | null, database: DatabaseSync) {
  if (parentId === null) {
    return;
  }
  if (parentId === nodeId) {
    throw new NarrativeValidationError("An outline node cannot be its own parent", ["parentId"]);
  }

  const visited = new Set<string>();
  let cursor: string | null = parentId;
  while (cursor) {
    if (cursor === nodeId) {
      throw new NarrativeValidationError("An outline node cannot become its own ancestor", ["parentId"]);
    }
    if (visited.has(cursor)) {
      throw new NarrativeValidationError("The outline contains a parent cycle", ["parentId"]);
    }
    visited.add(cursor);

    const row = database
      .prepare("SELECT id, project_id, parent_id FROM outline_nodes WHERE id = :id")
      .get({ id: cursor }) as { id: string; project_id: string; parent_id: string | null } | undefined;
    if (!row || row.project_id !== projectId) {
      throw new NarrativeValidationError("Parent outline node must belong to the same project", ["parentId"]);
    }
    cursor = row.parent_id;
  }
}

export function createOutlineNode(projectId: string, input: CreateOutlineNodeInput, database?: DatabaseSync) {
  const values = createOutlineNodeInputSchema.parse(input);
  const db = resolveDatabase(database);
  requireProject(projectId, db);
  validateOutlineParent(projectId, values.parentId, null, db);
  const id = randomUUID();
  const timestamp = now();
  const position = values.position ?? nextPosition(projectId, "outline_nodes", db);

  db.prepare("INSERT INTO outline_nodes (id, project_id, parent_id, kind, title, summary, position, created_at, updated_at) VALUES (:id, :projectId, :parentId, :kind, :title, :summary, :position, :createdAt, :updatedAt)")
    .run({ id, projectId, parentId: values.parentId, kind: values.kind, title: values.title, summary: values.summary, position, createdAt: timestamp, updatedAt: timestamp });

  return getOutlineNodeWithDatabase(id, db) as OutlineNode;
}

export function updateOutlineNode(nodeId: string, input: UpdateOutlineNodeInput, database?: DatabaseSync) {
  const values = updateOutlineNodeInputSchema.parse(input);
  const db = resolveDatabase(database);
  const current = getOutlineNodeWithDatabase(nodeId, db);
  if (!current) {
    return null;
  }
  if (values.parentId !== undefined) {
    validateOutlineParent(current.projectId, values.parentId, nodeId, db);
  }

  const fields: string[] = [];
  const parameters: SqliteParameters = { id: nodeId, updatedAt: now() };
  if (values.parentId !== undefined) {
    fields.push("parent_id = :parentId");
    parameters.parentId = values.parentId;
  }
  if (values.kind !== undefined) {
    fields.push("kind = :kind");
    parameters.kind = values.kind;
  }
  if (values.title !== undefined) {
    fields.push("title = :title");
    parameters.title = values.title;
  }
  if (values.summary !== undefined) {
    fields.push("summary = :summary");
    parameters.summary = values.summary;
  }
  if (values.position !== undefined) {
    fields.push("position = :position");
    parameters.position = values.position;
  }
  fields.push("updated_at = :updatedAt");

  db.prepare(`UPDATE outline_nodes SET ${fields.join(", ")} WHERE id = :id`).run(parameters);
  return getOutlineNodeWithDatabase(nodeId, db);
}

export function deleteOutlineNode(nodeId: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  const node = getOutlineNodeWithDatabase(nodeId, db);
  if (!node) {
    return false;
  }

  const child = db
    .prepare("SELECT id FROM outline_nodes WHERE parent_id = :parentId LIMIT 1")
    .get({ parentId: nodeId }) as { id?: string } | undefined;
  if (child) {
    throw new NarrativeValidationError("An outline node with children cannot be deleted", []);
  }

  const result = db.prepare("DELETE FROM outline_nodes WHERE id = :id").run({ id: nodeId });
  return result.changes > 0;
}

export function reorderOutlineNodes(projectId: string, input: OutlineOrderInput, database?: DatabaseSync) {
  const values = outlineOrderInputSchema.parse(input);
  const db = resolveDatabase(database);
  requireProject(projectId, db);

  db.exec("BEGIN IMMEDIATE");
  try {
    const allNodes = listOutlineNodes(projectId, db);
    const byId = new Map(allNodes.map((node) => [node.id, node]));
    const requestedIds = "orderedIds" in values
      ? values.orderedIds
      : values.items
        .slice()
        .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
        .map((item) => item.id);
    const seen = new Set<string>();

    for (const id of requestedIds) {
      if (seen.has(id)) {
        throw new NarrativeValidationError("Outline order cannot contain duplicate node IDs", ["orderedIds"]);
      }
      if (!byId.has(id)) {
        throw new NarrativeValidationError("Every outline node must belong to the same project", ["orderedIds"]);
      }
      seen.add(id);
    }

    if (requestedIds.length !== allNodes.length) {
      throw new NarrativeValidationError("Outline order must include every node in the project", ["orderedIds"]);
    }

    const statement = db.prepare("UPDATE outline_nodes SET position = :position, updated_at = :updatedAt WHERE id = :id AND project_id = :projectId");
    for (const [position, id] of requestedIds.entries()) {
      statement.run({ position, id, projectId, updatedAt: now() });
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return listOutlineNodes(projectId, db);
}

function getChapterWithDatabase(chapterId: string, database: DatabaseSync) {
  const row = database
    .prepare("SELECT id, project_id, outline_node_id, title, summary, body, position, status, created_at, updated_at FROM chapters WHERE id = :id")
    .get({ id: chapterId }) as unknown as ChapterRow | undefined;
  return row ? toChapter(row) : null;
}

export function listChapters(projectId: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  requireProject(projectId, db);
  const rows = db
    .prepare("SELECT id, project_id, outline_node_id, title, summary, body, position, status, created_at, updated_at FROM chapters WHERE project_id = :projectId ORDER BY position ASC, id ASC")
    .all({ projectId });
  return (rows as unknown as ChapterRow[]).map(toChapter);
}

export function getChapter(chapterId: string, database?: DatabaseSync) {
  return getChapterWithDatabase(chapterId, resolveDatabase(database));
}

function validateChapterOutlineReference(projectId: string, outlineNodeId: string | null, database: DatabaseSync) {
  if (outlineNodeId === null) {
    return;
  }
  const row = database
    .prepare("SELECT id, project_id FROM outline_nodes WHERE id = :id")
    .get({ id: outlineNodeId }) as { id: string; project_id: string } | undefined;
  if (!row || row.project_id !== projectId) {
    throw new NarrativeValidationError("Outline node must belong to the same project", ["outlineNodeId"]);
  }
}

export function createChapter(projectId: string, input: CreateChapterInput, database?: DatabaseSync) {
  const values = createChapterInputSchema.parse(input);
  const db = resolveDatabase(database);
  requireProject(projectId, db);
  validateChapterOutlineReference(projectId, values.outlineNodeId, db);
  const id = randomUUID();
  const timestamp = now();
  const position = values.position ?? nextPosition(projectId, "chapters", db);

  db.prepare("INSERT INTO chapters (id, project_id, outline_node_id, title, summary, body, position, status, created_at, updated_at) VALUES (:id, :projectId, :outlineNodeId, :title, :summary, :body, :position, :status, :createdAt, :updatedAt)")
    .run({ id, projectId, outlineNodeId: values.outlineNodeId, title: values.title, summary: values.summary, body: values.body, position, status: values.status, createdAt: timestamp, updatedAt: timestamp });

  return getChapterWithDatabase(id, db) as Chapter;
}

export function updateChapter(chapterId: string, input: UpdateChapterInput, database?: DatabaseSync) {
  const values = updateChapterInputSchema.parse(input);
  const db = resolveDatabase(database);
  const current = getChapterWithDatabase(chapterId, db);
  if (!current) {
    return null;
  }
  if (values.outlineNodeId !== undefined) {
    validateChapterOutlineReference(current.projectId, values.outlineNodeId, db);
  }
  if (current.updatedAt !== values.baseUpdatedAt) {
    throw new ChapterEditConflictError(current);
  }

  const fields: string[] = [];
  const parameters: SqliteParameters = {
    id: chapterId,
    baseUpdatedAt: values.baseUpdatedAt,
    updatedAt: nextRevisionTimestamp(current.updatedAt),
  };
  if (values.outlineNodeId !== undefined) {
    fields.push("outline_node_id = :outlineNodeId");
    parameters.outlineNodeId = values.outlineNodeId;
  }
  if (values.title !== undefined) {
    fields.push("title = :title");
    parameters.title = values.title;
  }
  if (values.summary !== undefined) {
    fields.push("summary = :summary");
    parameters.summary = values.summary;
  }
  if (values.body !== undefined) {
    fields.push("body = :body");
    parameters.body = values.body;
  }
  if (values.position !== undefined) {
    fields.push("position = :position");
    parameters.position = values.position;
  }
  if (values.status !== undefined) {
    fields.push("status = :status");
    parameters.status = values.status;
  }
  fields.push("updated_at = :updatedAt");

  const result = db.prepare(`UPDATE chapters SET ${fields.join(", ")} WHERE id = :id AND updated_at = :baseUpdatedAt`).run(parameters);
  if (result.changes === 0) {
    const latest = getChapterWithDatabase(chapterId, db);
    if (latest) {
      throw new ChapterEditConflictError(latest);
    }
    return null;
  }

  return getChapterWithDatabase(chapterId, db);
}

export function deleteChapter(chapterId: string, database?: DatabaseSync) {
  const result = resolveDatabase(database).prepare("DELETE FROM chapters WHERE id = :id").run({ id: chapterId });
  return result.changes > 0;
}

function getAdaptationWithDatabase(adaptationId: string, database: DatabaseSync) {
  const row = database
    .prepare("SELECT id, project_id, format, title, body, position, source_generation_id, created_at, updated_at FROM adaptations WHERE id = :id")
    .get({ id: adaptationId }) as unknown as AdaptationRow | undefined;
  return row ? toAdaptation(row) : null;
}

function getAdaptationBySourceGenerationWithDatabase(generationId: string, database: DatabaseSync) {
  const row = database
    .prepare("SELECT id, project_id, format, title, body, position, source_generation_id, created_at, updated_at FROM adaptations WHERE source_generation_id = :generationId")
    .get({ generationId }) as unknown as AdaptationRow | undefined;
  return row ? toAdaptation(row) : null;
}

export function listAdaptations(projectId: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  requireProject(projectId, db);
  const rows = db
    .prepare("SELECT id, project_id, format, title, body, position, source_generation_id, created_at, updated_at FROM adaptations WHERE project_id = :projectId ORDER BY position ASC, id ASC")
    .all({ projectId });
  return (rows as unknown as AdaptationRow[]).map(toAdaptation);
}

export function getAdaptation(adaptationId: string, database?: DatabaseSync) {
  return getAdaptationWithDatabase(adaptationId, resolveDatabase(database));
}

export function createAdaptation(projectId: string, input: CreateAdaptationInput, database?: DatabaseSync) {
  const values = createAdaptationInputSchema.parse(input);
  const db = resolveDatabase(database);
  requireProject(projectId, db);

  if (values.origin === "manual") {
    const id = randomUUID();
    const timestamp = now();
    const position = values.position ?? nextPosition(projectId, "adaptations", db);
    db.prepare("INSERT INTO adaptations (id, project_id, format, title, body, position, source_generation_id, created_at, updated_at) VALUES (:id, :projectId, :format, :title, :body, :position, NULL, :createdAt, :updatedAt)")
      .run({ id, projectId, format: values.format, title: values.title, body: values.body, position, createdAt: timestamp, updatedAt: timestamp });
    return getAdaptationWithDatabase(id, db) as Adaptation;
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const generation = getAiGenerationWithDatabase(values.generationId, db);
    if (!generation || generation.projectId !== projectId) {
      throw new NarrativeNotFoundError("AI generation not found");
    }
    if (generation.action !== "adapt") {
      throw new NarrativeValidationError("Only adapt AI generations can create adaptations", ["generationId"]);
    }
    if (generation.acceptedVersionId) {
      throw new AiGenerationAlreadyConsumedError(generation, "chapter");
    }
    const existingAdaptation = getAdaptationBySourceGenerationWithDatabase(generation.id, db);
    if (existingAdaptation) {
      throw new AiGenerationAlreadyConsumedError(generation, "adaptation", existingAdaptation);
    }

    const id = randomUUID();
    const timestamp = now();
    const position = values.position ?? nextPosition(projectId, "adaptations", db);
    db.prepare("INSERT INTO adaptations (id, project_id, format, title, body, position, source_generation_id, created_at, updated_at) VALUES (:id, :projectId, :format, :title, :body, :position, :sourceGenerationId, :createdAt, :updatedAt)")
      .run({ id, projectId, format: values.format, title: values.title, body: generation.generatedMarkdown, position, sourceGenerationId: generation.id, createdAt: timestamp, updatedAt: timestamp });

    const adaptation = getAdaptationWithDatabase(id, db);
    if (!adaptation || adaptation.sourceGenerationId !== generation.id || adaptation.body !== generation.generatedMarkdown) {
      throw new NarrativeDataIntegrityError("AI adaptation could not be verified before commit");
    }
    db.exec("COMMIT");
    return adaptation;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the original transaction error.
    }
    throw error;
  }
}

export function updateAdaptation(adaptationId: string, input: UpdateAdaptationInput, database?: DatabaseSync) {
  const values = updateAdaptationInputSchema.parse(input);
  const db = resolveDatabase(database);
  const current = getAdaptationWithDatabase(adaptationId, db);
  if (!current) {
    return null;
  }
  if (current.updatedAt !== values.baseUpdatedAt) {
    throw new AdaptationEditConflictError(current);
  }

  const fields: string[] = [];
  const parameters: SqliteParameters = {
    id: adaptationId,
    baseUpdatedAt: values.baseUpdatedAt,
    updatedAt: nextRevisionTimestamp(current.updatedAt),
  };
  if (values.title !== undefined) {
    fields.push("title = :title");
    parameters.title = values.title;
  }
  if (values.body !== undefined) {
    fields.push("body = :body");
    parameters.body = values.body;
  }
  if (values.position !== undefined) {
    fields.push("position = :position");
    parameters.position = values.position;
  }
  fields.push("updated_at = :updatedAt");

  const result = db.prepare(`UPDATE adaptations SET ${fields.join(", ")} WHERE id = :id AND updated_at = :baseUpdatedAt`).run(parameters);
  if (result.changes === 0) {
    const latest = getAdaptationWithDatabase(adaptationId, db);
    if (latest) {
      throw new AdaptationEditConflictError(latest);
    }
    return null;
  }

  return getAdaptationWithDatabase(adaptationId, db);
}

export function deleteAdaptation(adaptationId: string, database?: DatabaseSync) {
  const result = resolveDatabase(database).prepare("DELETE FROM adaptations WHERE id = :id").run({ id: adaptationId });
  return result.changes > 0;
}

function getChapterVersionWithDatabase(chapterId: string, versionId: string, database: DatabaseSync) {
  const row = database
    .prepare("SELECT id, chapter_id, body, source, ai_action, instruction, context_reference_ids, created_at FROM chapter_versions WHERE id = :id AND chapter_id = :chapterId")
    .get({ id: versionId, chapterId }) as unknown as ChapterVersionRow | undefined;
  return row ? toChapterVersion(row) : null;
}

export function listChapterVersions(chapterId: string, database?: DatabaseSync) {
  const rows = resolveDatabase(database)
    .prepare("SELECT id, chapter_id, body, source, ai_action, instruction, context_reference_ids, created_at FROM chapter_versions WHERE chapter_id = :chapterId ORDER BY created_at DESC, id DESC")
    .all({ chapterId });
  return (rows as unknown as ChapterVersionRow[]).map(toChapterVersion);
}

function insertChapterVersion(database: DatabaseSync, values: { chapterId: string; body: string; source: ChapterVersion["source"]; aiAction?: string | null; instruction?: string | null; contextReferenceIds?: string[] }) {
  const id = randomUUID();
  database.prepare("INSERT INTO chapter_versions (id, chapter_id, body, source, ai_action, instruction, context_reference_ids, created_at) VALUES (:id, :chapterId, :body, :source, :aiAction, :instruction, :contextReferenceIds, :createdAt)")
    .run({ id, chapterId: values.chapterId, body: values.body, source: values.source, aiAction: values.aiAction ?? null, instruction: values.instruction ?? null, contextReferenceIds: values.contextReferenceIds ? JSON.stringify(values.contextReferenceIds) : null, createdAt: now() });
  return id;
}

export function getChapterVersion(chapterId: string, versionId: string, database?: DatabaseSync) {
  return getChapterVersionWithDatabase(chapterId, versionId, resolveDatabase(database));
}

function getAiGenerationWithDatabase(generationId: string, database: DatabaseSync) {
  const row = database
    .prepare("SELECT id, project_id, target_chapter_id, action, instruction, context_reference_ids, generated_markdown, created_at, accepted_version_id FROM ai_generations WHERE id = :id")
    .get({ id: generationId }) as unknown as AiGenerationRow | undefined;
  return row ? toAiGeneration(row) : null;
}

export function getAiGeneration(generationId: string, database?: DatabaseSync) {
  return getAiGenerationWithDatabase(generationId, resolveDatabase(database));
}

export function createAiGeneration(input: CreateAiGenerationInput, database?: DatabaseSync) {
  const values = createAiGenerationInputSchema.parse(input);
  const db = resolveDatabase(database);
  requireProject(values.projectId, db);
  const targetChapter = getChapterWithDatabase(values.targetChapterId, db);
  if (!targetChapter || targetChapter.projectId !== values.projectId) {
    throw new NarrativeNotFoundError("Chapter not found");
  }

  const id = randomUUID();
  db.prepare("INSERT INTO ai_generations (id, project_id, target_chapter_id, action, instruction, context_reference_ids, generated_markdown, created_at, accepted_version_id) VALUES (:id, :projectId, :targetChapterId, :action, :instruction, :contextReferenceIds, :generatedMarkdown, :createdAt, NULL)")
    .run({
      id,
      projectId: values.projectId,
      targetChapterId: values.targetChapterId,
      action: values.action,
      instruction: values.instruction,
      contextReferenceIds: JSON.stringify(values.contextReferenceIds),
      generatedMarkdown: values.generatedMarkdown,
      createdAt: now(),
    });
  return getAiGenerationWithDatabase(id, db) as AiGeneration;
}

export function acceptAiGeneration(chapterId: string, input: { generationId: string; body: string; baseUpdatedAt: string }, database?: DatabaseSync) {
  const values = aiAcceptInputSchema.parse(input);
  const db = resolveDatabase(database);
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = getChapterWithDatabase(chapterId, db);
    if (!current) {
      throw new NarrativeNotFoundError("Chapter not found");
    }
    const generation = getAiGenerationWithDatabase(values.generationId, db);
    if (!generation || generation.projectId !== current.projectId || generation.targetChapterId !== chapterId) {
      throw new NarrativeNotFoundError("AI generation not found");
    }
    const existingAdaptation = getAdaptationBySourceGenerationWithDatabase(generation.id, db);
    if (existingAdaptation) {
      throw new AiGenerationAlreadyConsumedError(generation, "adaptation", existingAdaptation);
    }
    if (generation.acceptedVersionId) {
      throw new AiGenerationAlreadyAcceptedError(generation);
    }
    if (current.updatedAt !== values.baseUpdatedAt) {
      throw new ChapterEditConflictError(current);
    }

    const updatedAt = nextRevisionTimestamp(current.updatedAt);
    const updateResult = db.prepare("UPDATE chapters SET body = :body, updated_at = :updatedAt WHERE id = :id AND updated_at = :baseUpdatedAt")
      .run({ id: chapterId, body: values.body, updatedAt, baseUpdatedAt: values.baseUpdatedAt });
    if (updateResult.changes === 0) {
      const latest = getChapterWithDatabase(chapterId, db);
      if (latest) {
        throw new ChapterEditConflictError(latest);
      }
      throw new NarrativeNotFoundError("Chapter not found");
    }

    const versionId = insertChapterVersion(db, {
      chapterId,
      body: values.body,
      source: "ai",
      aiAction: generation.action,
      instruction: generation.instruction,
      contextReferenceIds: generation.contextReferenceIds,
    });
    const linkResult = db.prepare("UPDATE ai_generations SET accepted_version_id = :versionId WHERE id = :generationId AND accepted_version_id IS NULL")
      .run({ versionId, generationId: generation.id });
    if (linkResult.changes === 0) {
      const latestGeneration = getAiGenerationWithDatabase(generation.id, db);
      if (latestGeneration?.acceptedVersionId) {
        throw new AiGenerationAlreadyAcceptedError(latestGeneration);
      }
      throw new NarrativeDataIntegrityError("AI generation could not be linked to its accepted version");
    }

    const acceptedChapter = getChapterWithDatabase(chapterId, db);
    const acceptedVersion = getChapterVersionWithDatabase(chapterId, versionId, db);
    const acceptedGeneration = getAiGenerationWithDatabase(generation.id, db);
    if (!acceptedChapter || !acceptedVersion || !acceptedGeneration || acceptedGeneration.acceptedVersionId !== versionId) {
      throw new NarrativeDataIntegrityError("Accepted AI generation could not be verified before commit");
    }
    db.exec("COMMIT");
    return { chapter: acceptedChapter, version: acceptedVersion, generation: acceptedGeneration };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the original transaction error.
    }
    throw error;
  }
}

export function createChapterVersion(chapterId: string, input: CreateChapterVersionInput, database?: DatabaseSync) {
  const values = createChapterVersionInputSchema.parse(input);
  const db = resolveDatabase(database);
  const chapter = getChapterWithDatabase(chapterId, db);
  if (!chapter) {
    return null;
  }
  const id = insertChapterVersion(db, { chapterId, body: chapter.body, source: values.source, aiAction: values.aiAction, instruction: values.instruction, contextReferenceIds: values.contextReferenceIds });
  return getChapterVersionWithDatabase(chapterId, id, db) as ChapterVersion;
}

export function restoreChapterVersion(chapterId: string, versionId: string, baseUpdatedAt: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  const current = getChapterWithDatabase(chapterId, db);
  const target = getChapterVersionWithDatabase(chapterId, versionId, db);
  if (!current || !target) {
    return null;
  }
  if (current.updatedAt !== baseUpdatedAt) {
    throw new ChapterEditConflictError(current);
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const updatedAt = nextRevisionTimestamp(current.updatedAt);
    const result = db.prepare("UPDATE chapters SET body = :body, updated_at = :updatedAt WHERE id = :id AND updated_at = :baseUpdatedAt").run({ id: chapterId, body: target.body, updatedAt, baseUpdatedAt });
    if (result.changes === 0) {
      const latest = getChapterWithDatabase(chapterId, db);
      if (latest) {
        throw new ChapterEditConflictError(latest);
      }
      throw new NarrativeNotFoundError("Chapter not found");
    }
    const backupId = insertChapterVersion(db, { chapterId, body: current.body, source: "restore_backup" });
    db.exec("COMMIT");
    return {
      chapter: getChapterWithDatabase(chapterId, db) as Chapter,
      backupVersion: getChapterVersionWithDatabase(chapterId, backupId, db) as ChapterVersion,
      restoredVersion: target,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getNarrativeWorkspace(projectId: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  const project = getProjectWithDatabase(projectId, db);
  if (!project) {
    return null;
  }
  return {
    project,
    bibleEntries: listBibleEntries(projectId, db),
    outlineNodes: listOutlineNodes(projectId, db),
    chapters: listChapters(projectId, db),
    adaptations: listAdaptations(projectId, db),
  };
}

export function createNarrativeRepository(database: DatabaseSync = getDatabase()) {
  return {
    listBibleEntries: (projectId: string) => listBibleEntries(projectId, database),
    getBibleEntry: (entryId: string) => getBibleEntry(entryId, database),
    createBibleEntry: (projectId: string, input: CreateBibleEntryInput) => createBibleEntry(projectId, input, database),
    updateBibleEntry: (entryId: string, input: UpdateBibleEntryInput) => updateBibleEntry(entryId, input, database),
    deleteBibleEntry: (entryId: string) => deleteBibleEntry(entryId, database),
    listOutlineNodes: (projectId: string) => listOutlineNodes(projectId, database),
    getOutlineNode: (nodeId: string) => getOutlineNode(nodeId, database),
    createOutlineNode: (projectId: string, input: CreateOutlineNodeInput) => createOutlineNode(projectId, input, database),
    updateOutlineNode: (nodeId: string, input: UpdateOutlineNodeInput) => updateOutlineNode(nodeId, input, database),
    deleteOutlineNode: (nodeId: string) => deleteOutlineNode(nodeId, database),
    reorderOutlineNodes: (projectId: string, input: OutlineOrderInput) => reorderOutlineNodes(projectId, input, database),
    listChapters: (projectId: string) => listChapters(projectId, database),
    getChapter: (chapterId: string) => getChapter(chapterId, database),
    createChapter: (projectId: string, input: CreateChapterInput) => createChapter(projectId, input, database),
    updateChapter: (chapterId: string, input: UpdateChapterInput) => updateChapter(chapterId, input, database),
    deleteChapter: (chapterId: string) => deleteChapter(chapterId, database),
    listAdaptations: (projectId: string) => listAdaptations(projectId, database),
    getAdaptation: (adaptationId: string) => getAdaptation(adaptationId, database),
    createAdaptation: (projectId: string, input: CreateAdaptationInput) => createAdaptation(projectId, input, database),
    updateAdaptation: (adaptationId: string, input: UpdateAdaptationInput) => updateAdaptation(adaptationId, input, database),
    deleteAdaptation: (adaptationId: string) => deleteAdaptation(adaptationId, database),
    listChapterVersions: (chapterId: string) => listChapterVersions(chapterId, database),
    getChapterVersion: (chapterId: string, versionId: string) => getChapterVersion(chapterId, versionId, database),
    createChapterVersion: (chapterId: string, input: CreateChapterVersionInput) => createChapterVersion(chapterId, input, database),
    restoreChapterVersion: (chapterId: string, versionId: string, baseUpdatedAt: string) => restoreChapterVersion(chapterId, versionId, baseUpdatedAt, database),
    getAiGeneration: (generationId: string) => getAiGeneration(generationId, database),
    createAiGeneration: (input: CreateAiGenerationInput) => createAiGeneration(input, database),
    acceptAiGeneration: (chapterId: string, input: { generationId: string; body: string; baseUpdatedAt: string }) => acceptAiGeneration(chapterId, input, database),
    getNarrativeWorkspace: (projectId: string) => getNarrativeWorkspace(projectId, database),
  };
}
