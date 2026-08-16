import "server-only";

import fs from "node:fs";
import path from "node:path";
import type { ZodType } from "zod";

import {
  allocateUniqueSlug,
  chapterRecordSchema,
  createChapterInputSchema,
  createEntityInputSchema,
  createProjectInputSchema,
  createSceneInputSchema,
  createVolumeInputSchema,
  ENTITY_KIND_DIRS,
  entityKindSchema,
  entityRecordSchema,
  nextNumberedId,
  projectRecordSchema,
  sceneRecordSchema,
  slugifyTitle,
  STUDIO_ENTITY_KINDS,
  STUDIO_SCHEMA_VERSION,
  styleRecordSchema,
  updateChapterInputSchema,
  updateEntityInputSchema,
  updateProjectInputSchema,
  updateSceneInputSchema,
  updateShotInputSchema,
  updateVolumeInputSchema,
  volumeRecordSchema,
  type CreateChapterInput,
  type CreateEntityInput,
  type CreateProjectInput,
  type CreateSceneInput,
  type CreateVolumeInput,
  type StudioChapter,
  type StudioEntity,
  type StudioEntityKind,
  type StudioProject,
  type StudioProjectSummary,
  type StudioScene,
  type StudioShot,
  type StudioStoryTree,
  type StudioStoryTreeChapter,
  type StudioStoryTreeScene,
  type StudioStoryTreeVolume,
  type StudioStyle,
  type StudioVolume,
  type UpdateChapterInput,
  type UpdateEntityInput,
  type UpdateProjectInput,
  type UpdateSceneInput,
  type UpdateShotInput,
  type UpdateVolumeInput,
} from "../domain";
import { StudioEditConflictError, StudioIdConflictError, StudioNotFoundError, StudioValidationError } from "../errors";
import { deleteWorkflowNode } from "../generate/workflow-store";
import { ensureDirectory, parseJsonRecord, writeJsonFile } from "./json";
import { assertStudioId, constrainToWorkspaceRoot, resolveUnderWorkspace } from "./paths";
import { getWorkspaceRoot } from "./workspace";

export { getWorkspaceRoot };

type ProjectContext = {
  root: string;
  projectId: string;
  projectDir: string;
  project: StudioProject;
};

type VolumeContext = ProjectContext & {
  volumeId: string;
  volumeDir: string;
  volume: StudioVolume;
};

type ChapterContext = VolumeContext & {
  chapterId: string;
  chapterDir: string;
  chapter: StudioChapter;
};

export function listProjects(): StudioProjectSummary[] {
  const root = getWorkspaceRoot();
  const projects: StudioProjectSummary[] = [];

  for (const entry of readDirSafe(root)) {
    const folderName = entry.name;
    if (!entryLooksLikeDirectory(root, entry)) {
      continue;
    }

    const summary = tryReadProjectSummary(root, folderName);
    if (summary) {
      projects.push(summary);
    }
  }

  return projects.sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) {
      return left.updatedAt < right.updatedAt ? 1 : -1;
    }
    return compareIds(left.id, right.id);
  });
}

export function createProject(input: CreateProjectInput): StudioProject {
  const values = parseInput(createProjectInputSchema, input);
  const root = getWorkspaceRoot();
  const id = values.id
    ? assertStudioId(values.id, "id")
    : allocateUniqueSlug(slugifyTitle(values.title), (candidate) => directoryExists(root, candidate));

  if (values.id && directoryExists(root, id)) {
    throw new StudioIdConflictError();
  }

  const projectDir = resolveUnderWorkspace(root, [id]);
  if (fs.existsSync(projectDir)) {
    throw new StudioIdConflictError();
  }

  const now = nowIso();
  const project: StudioProject = {
    schemaVersion: STUDIO_SCHEMA_VERSION,
    id,
    title: values.title,
    createdAt: now,
    updatedAt: now,
  };

  const tempDir = constrainToWorkspaceRoot(
    root,
    path.resolve(root, `.creating-${id}-${process.pid}-${process.hrtime.bigint()}`),
  );

  try {
    writeDefaultProjectTree(tempDir, project, now);
    fs.renameSync(tempDir, projectDir);
  } catch (error) {
    removePathSafe(tempDir);
    if (isAlreadyExists(error) || fs.existsSync(projectDir)) {
      throw new StudioIdConflictError();
    }
    throw error;
  }

  return project;
}

export function readProject(projectId: string): StudioProject {
  return requireProject(projectId).project;
}

export function updateProject(projectId: string, input: UpdateProjectInput): StudioProject {
  const ctx = requireProject(projectId);
  const values = parseInput(updateProjectInputSchema, input);
  assertFresh(ctx.project.updatedAt, values.expectedUpdatedAt, ctx.project);

  const next: StudioProject = {
    ...ctx.project,
    title: values.title,
    updatedAt: nowIso(ctx.project.updatedAt),
  };

  writeJsonFile(projectFile(ctx, "project.json"), next);
  return next;
}

export function readTree(projectId: string): StudioStoryTree {
  const ctx = requireProject(projectId);
  const volumesDir = projectFile(ctx, "content", "volumes");
  if (!fs.existsSync(volumesDir)) {
    return { volumes: [] };
  }

  const volumes: StudioStoryTreeVolume[] = [];
  for (const entry of readDirSafe(volumesDir)) {
    if (!entryLooksLikeDirectory(volumesDir, entry)) {
      continue;
    }

    const volume = tryReadVolume(ctx, entry.name);
    if (!volume) {
      continue;
    }

    volumes.push({
      id: volume.id,
      title: volume.title,
      updatedAt: volume.updatedAt,
      chapters: readChapterNodes(ctx, volume.id),
    });
  }

  return { volumes: volumes.sort((left, right) => compareIds(left.id, right.id)) };
}

export function createVolume(projectId: string, input: CreateVolumeInput = {}): StudioVolume {
  const ctx = requireProject(projectId);
  const values = parseInput(createVolumeInputSchema, input);
  const existing = listChildIds(projectFile(ctx, "content", "volumes"), { directories: true });
  const id = values.id ? assertStudioId(values.id, "id") : nextNumberedId("volume", existing);
  assertIdAvailable(existing, id);

  const now = nowIso();
  const volume: StudioVolume = {
    id,
    title: values.title ?? defaultNumberedTitle("volume", "Volume", id, "Untitled volume"),
    updatedAt: now,
  };

  writeJsonFile(projectFile(ctx, "content", "volumes", id, "volume.json"), volume);
  ensureDirectory(projectFile(ctx, "content", "volumes", id, "chapters"));
  return volume;
}

export function updateVolume(projectId: string, volumeId: string, input: UpdateVolumeInput): StudioVolume {
  const ctx = requireVolume(projectId, volumeId);
  const values = parseInput(updateVolumeInputSchema, input);
  assertFresh(ctx.volume.updatedAt, values.expectedUpdatedAt, ctx.volume);

  const next: StudioVolume = {
    ...ctx.volume,
    title: values.title,
    updatedAt: nowIso(ctx.volume.updatedAt),
  };

  writeJsonFile(path.join(ctx.volumeDir, "volume.json"), next);
  return next;
}

export function deleteVolume(projectId: string, volumeId: string): { deleted: true } {
  const ctx = requireVolume(projectId, volumeId);
  const artifacts = collectVolumeArtifacts(ctx);
  removePathSafe(ctx.volumeDir);
  cleanupSceneArtifacts(ctx, artifacts);
  return { deleted: true };
}

export function createChapter(projectId: string, volumeId: string, input: CreateChapterInput = {}): StudioChapter {
  const ctx = requireVolume(projectId, volumeId);
  const values = parseInput(createChapterInputSchema, input);
  const chaptersDir = path.join(ctx.volumeDir, "chapters");
  const existing = listChildIds(chaptersDir, { directories: true });
  const id = values.id ? assertStudioId(values.id, "id") : nextNumberedId("chapter", existing);
  assertIdAvailable(existing, id);

  const now = nowIso();
  const chapter: StudioChapter = {
    id,
    title: values.title ?? defaultNumberedTitle("chapter", "Chapter", id, "Untitled chapter"),
    updatedAt: now,
  };

  writeJsonFile(path.join(chaptersDir, id, "chapter.json"), chapter);
  ensureDirectory(path.join(chaptersDir, id, "scenes"));
  return chapter;
}

export function updateChapter(
  projectId: string,
  volumeId: string,
  chapterId: string,
  input: UpdateChapterInput,
): StudioChapter {
  const ctx = requireChapter(projectId, volumeId, chapterId);
  const values = parseInput(updateChapterInputSchema, input);
  assertFresh(ctx.chapter.updatedAt, values.expectedUpdatedAt, ctx.chapter);

  const next: StudioChapter = {
    ...ctx.chapter,
    title: values.title,
    updatedAt: nowIso(ctx.chapter.updatedAt),
  };

  writeJsonFile(path.join(ctx.chapterDir, "chapter.json"), next);
  return next;
}

export function deleteChapter(
  projectId: string,
  volumeId: string,
  chapterId: string,
): { deleted: true } {
  const ctx = requireChapter(projectId, volumeId, chapterId);
  const artifacts = collectChapterArtifacts(ctx);
  removePathSafe(ctx.chapterDir);
  cleanupSceneArtifacts(ctx, artifacts);
  return { deleted: true };
}

export function createScene(
  projectId: string,
  volumeId: string,
  chapterId: string,
  input: CreateSceneInput = {},
): StudioScene {
  const ctx = requireChapter(projectId, volumeId, chapterId);
  const values = parseInput(createSceneInputSchema, input);
  const scenesDir = path.join(ctx.chapterDir, "scenes");
  const existing = listChildIds(scenesDir, { files: true });
  const id = values.id ? assertStudioId(values.id, "id") : nextNumberedId("scene", existing);
  assertIdAvailable(existing, id);

  const scene = defaultScene(id, values.title ?? "Untitled scene", nowIso());
  writeJsonFile(path.join(scenesDir, `${id}.json`), scene);
  return scene;
}

export function readScene(projectId: string, volumeId: string, chapterId: string, sceneId: string): StudioScene {
  return requireScene(projectId, volumeId, chapterId, sceneId).scene;
}

export function deleteScene(
  projectId: string,
  volumeId: string,
  chapterId: string,
  sceneId: string,
): { deleted: true } {
  const ctx = requireScene(projectId, volumeId, chapterId, sceneId);
  const artifacts = collectSceneArtifacts(ctx.scene);
  removePathSafe(ctx.sceneFile);
  cleanupSceneArtifacts(ctx, artifacts);
  return { deleted: true };
}

export function updateScene(
  projectId: string,
  volumeId: string,
  chapterId: string,
  sceneId: string,
  input: UpdateSceneInput,
): StudioScene {
  const ctx = requireScene(projectId, volumeId, chapterId, sceneId);
  const values = parseInput(updateSceneInputSchema, input);
  assertFresh(ctx.scene.updatedAt, values.expectedUpdatedAt, ctx.scene);

  const next: StudioScene = {
    id: ctx.scene.id,
    title: values.title ?? ctx.scene.title,
    script: values.script ?? ctx.scene.script,
    intent: values.intent ?? ctx.scene.intent,
    characters: values.characters ?? ctx.scene.characters,
    location: values.location === undefined ? ctx.scene.location : values.location,
    props: values.props ?? ctx.scene.props,
    costumes: values.costumes ?? ctx.scene.costumes,
    shots: ctx.scene.shots,
    updatedAt: nowIso(ctx.scene.updatedAt),
    provenance: values.provenance ?? ctx.scene.provenance,
    canonFields: values.canonFields ?? ctx.scene.canonFields,
  };

  writeJsonFile(ctx.sceneFile, next);
  return next;
}

export function listShots(
  projectId: string,
  volumeId: string,
  chapterId: string,
  sceneId: string,
): StudioShot[] {
  return requireScene(projectId, volumeId, chapterId, sceneId).scene.shots;
}

export function replaceSceneShots(
  projectId: string,
  volumeId: string,
  chapterId: string,
  sceneId: string,
  shots: readonly StudioShot[],
): StudioScene {
  const ctx = requireScene(projectId, volumeId, chapterId, sceneId);
  const next: StudioScene = {
    ...ctx.scene,
    shots: [...shots],
    updatedAt: nowIso(ctx.scene.updatedAt),
  };

  writeJsonFile(ctx.sceneFile, next);
  return next;
}

export function updateShot(
  projectId: string,
  volumeId: string,
  chapterId: string,
  sceneId: string,
  shotId: string,
  input: UpdateShotInput,
): StudioShot {
  const ctx = requireScene(projectId, volumeId, chapterId, sceneId);
  const values = parseInput(updateShotInputSchema, input);
  const id = assertStudioId(shotId, "shotId");
  const index = ctx.scene.shots.findIndex((shot) => shot.id === id);
  const current = ctx.scene.shots[index];
  if (index < 0 || !current) {
    throw new StudioNotFoundError("Shot not found.");
  }

  assertFresh(current.updatedAt, values.expectedUpdatedAt, current);

  const nextShot: StudioShot = {
    ...current,
    purpose: values.purpose ?? current.purpose,
    action: values.action ?? current.action,
    camera: values.camera ?? current.camera,
    continuity_from: values.continuity_from === undefined ? current.continuity_from : values.continuity_from,
    status: values.status ?? current.status,
    selected_image: values.selected_image === undefined ? current.selected_image : values.selected_image,
    updatedAt: nowIso(current.updatedAt),
  };

  const shots = ctx.scene.shots.slice();
  shots[index] = nextShot;
  writeJsonFile(ctx.sceneFile, { ...ctx.scene, shots });
  return nextShot;
}

export function listEntities(projectId: string, kind: StudioEntityKind): StudioEntity[] {
  const ctx = requireProject(projectId);
  const resolvedKind = parseInput(entityKindSchema, kind);
  const entitiesDir = entityKindDir(ctx, resolvedKind);
  const entities: StudioEntity[] = [];

  for (const id of listChildIds(entitiesDir, { files: true })) {
    const entity = tryReadEntityFile(path.join(entitiesDir, `${id}.json`), id, resolvedKind);
    if (entity) {
      entities.push(entity);
    }
  }

  return entities.sort((left, right) => compareIds(left.id, right.id));
}

export function createEntity(projectId: string, input: CreateEntityInput): StudioEntity {
  const ctx = requireProject(projectId);
  const values = parseInput(createEntityInputSchema, input);
  const existing = STUDIO_ENTITY_KINDS.flatMap((kind) => listChildIds(entityKindDir(ctx, kind), { files: true }));
  const id = values.id
    ? assertStudioId(values.id, "id")
    : nextNumberedId(values.kind, listChildIds(entityKindDir(ctx, values.kind), { files: true }));
  assertIdAvailable(existing, id);

  const entity: StudioEntity = {
    id,
    kind: values.kind,
    name: values.name,
    description: "",
    visual: { base: "", references: [] },
    states: { default: { outfit: "", condition: "" } },
    updatedAt: nowIso(),
  };

  const entityDir = entityKindDir(ctx, values.kind);
  ensureDirectory(entityDir);
  writeJsonFile(path.join(entityDir, `${id}.json`), entity);
  return entity;
}

export function readEntity(projectId: string, entityId: string): StudioEntity {
  return requireEntity(projectId, entityId).entity;
}

export function readStyle(projectId: string): StudioStyle {
  const ctx = requireProject(projectId);
  const file = projectFile(ctx, "styles", "default.json");
  if (!fs.existsSync(file)) {
    throw new StudioNotFoundError("Style not found.");
  }

  return parseJsonRecord(file, styleRecordSchema);
}

export function updateEntity(projectId: string, entityId: string, input: UpdateEntityInput): StudioEntity {
  const ctx = requireEntity(projectId, entityId);
  const values = parseInput(updateEntityInputSchema, input);
  assertFresh(ctx.entity.updatedAt, values.expectedUpdatedAt, ctx.entity);

  const next: StudioEntity = {
    ...ctx.entity,
    name: values.name ?? ctx.entity.name,
    description: values.description ?? ctx.entity.description,
    visual: values.visual ?? ctx.entity.visual,
    states: values.states ?? ctx.entity.states,
    updatedAt: nowIso(ctx.entity.updatedAt),
    provenance: values.provenance ?? ctx.entity.provenance,
    canonFields: values.canonFields ?? ctx.entity.canonFields,
  };

  writeJsonFile(ctx.entityFile, next);
  return next;
}

function requireProject(projectId: string): ProjectContext {
  const root = getWorkspaceRoot();
  const id = assertStudioId(projectId, "projectId");
  const projectDir = resolveUnderWorkspace(root, [id]);
  const file = resolveUnderWorkspace(root, [id, "project.json"]);

  if (!fs.existsSync(file)) {
    throw new StudioNotFoundError("Project not found.");
  }

  const project = parseJsonRecord(file, projectRecordSchema);
  if (project.id !== id) {
    throw new StudioNotFoundError("Project not found.");
  }

  return { root, projectId: id, projectDir, project };
}

function requireVolume(projectId: string, volumeId: string): VolumeContext {
  const ctx = requireProject(projectId);
  const id = assertStudioId(volumeId, "volumeId");
  const volumeDir = projectFile(ctx, "content", "volumes", id);
  const file = path.join(volumeDir, "volume.json");

  if (!fs.existsSync(file)) {
    throw new StudioNotFoundError("Volume not found.");
  }

  const volume = parseJsonRecord(file, volumeRecordSchema);
  if (volume.id !== id) {
    throw new StudioNotFoundError("Volume not found.");
  }

  return { ...ctx, volumeId: id, volumeDir, volume };
}

function requireChapter(projectId: string, volumeId: string, chapterId: string): ChapterContext {
  const ctx = requireVolume(projectId, volumeId);
  const id = assertStudioId(chapterId, "chapterId");
  const chapterDir = constrainToWorkspaceRoot(ctx.root, path.resolve(ctx.volumeDir, "chapters", id));
  const file = path.join(chapterDir, "chapter.json");

  if (!fs.existsSync(file)) {
    throw new StudioNotFoundError("Chapter not found.");
  }

  const chapter = parseJsonRecord(file, chapterRecordSchema);
  if (chapter.id !== id) {
    throw new StudioNotFoundError("Chapter not found.");
  }

  return { ...ctx, chapterId: id, chapterDir, chapter };
}

function requireScene(projectId: string, volumeId: string, chapterId: string, sceneId: string) {
  const ctx = requireChapter(projectId, volumeId, chapterId);
  const id = assertStudioId(sceneId, "sceneId");
  const sceneFile = constrainToWorkspaceRoot(ctx.root, path.resolve(ctx.chapterDir, "scenes", `${id}.json`));

  if (!fs.existsSync(sceneFile)) {
    throw new StudioNotFoundError("Scene not found.");
  }

  const scene = parseJsonRecord(sceneFile, sceneRecordSchema);
  if (scene.id !== id) {
    throw new StudioNotFoundError("Scene not found.");
  }

  return { ...ctx, sceneId: id, sceneFile, scene };
}

function requireEntity(projectId: string, entityId: string) {
  const ctx = requireProject(projectId);
  const id = assertStudioId(entityId, "entityId");

  for (const kind of STUDIO_ENTITY_KINDS) {
    const entityFile = path.join(entityKindDir(ctx, kind), `${id}.json`);
    if (!fs.existsSync(entityFile)) {
      continue;
    }

    const entity = tryReadEntityFile(entityFile, id, kind);
    if (entity) {
      return { ...ctx, entityId: id, entityFile, entity };
    }
  }

  throw new StudioNotFoundError("Entity not found.");
}

function tryReadProjectSummary(root: string, folderName: string): StudioProjectSummary | null {
  try {
    assertStudioId(folderName, "projectId");
    const file = resolveUnderWorkspace(root, [folderName, "project.json"]);
    if (!fs.existsSync(file)) {
      return null;
    }

    const project = parseJsonRecord(file, projectRecordSchema);
    if (project.id !== folderName) {
      return null;
    }

    return { id: project.id, title: project.title, updatedAt: project.updatedAt };
  } catch {
    return null;
  }
}

function tryReadVolume(ctx: ProjectContext, volumeId: string): StudioVolume | null {
  try {
    assertStudioId(volumeId, "volumeId");
    const file = projectFile(ctx, "content", "volumes", volumeId, "volume.json");
    if (!fs.existsSync(file)) {
      return null;
    }

    const volume = parseJsonRecord(file, volumeRecordSchema);
    return volume.id === volumeId ? volume : null;
  } catch {
    return null;
  }
}

function readChapterNodes(ctx: ProjectContext, volumeId: string): StudioStoryTreeChapter[] {
  const chaptersDir = projectFile(ctx, "content", "volumes", volumeId, "chapters");
  if (!fs.existsSync(chaptersDir)) {
    return [];
  }

  const chapters: StudioStoryTreeChapter[] = [];
  for (const entry of readDirSafe(chaptersDir)) {
    if (!entryLooksLikeDirectory(chaptersDir, entry)) {
      continue;
    }

    const chapter = tryReadChapter(ctx, volumeId, entry.name);
    if (!chapter) {
      continue;
    }

    chapters.push({
      id: chapter.id,
      title: chapter.title,
      updatedAt: chapter.updatedAt,
      scenes: readSceneNodes(ctx, volumeId, chapter.id),
    });
  }

  return chapters.sort((left, right) => compareIds(left.id, right.id));
}

function tryReadChapter(ctx: ProjectContext, volumeId: string, chapterId: string): StudioChapter | null {
  try {
    assertStudioId(chapterId, "chapterId");
    const file = projectFile(ctx, "content", "volumes", volumeId, "chapters", chapterId, "chapter.json");
    if (!fs.existsSync(file)) {
      return null;
    }

    const chapter = parseJsonRecord(file, chapterRecordSchema);
    return chapter.id === chapterId ? chapter : null;
  } catch {
    return null;
  }
}

function readSceneNodes(ctx: ProjectContext, volumeId: string, chapterId: string): StudioStoryTreeScene[] {
  const scenesDir = projectFile(ctx, "content", "volumes", volumeId, "chapters", chapterId, "scenes");
  if (!fs.existsSync(scenesDir)) {
    return [];
  }

  const scenes: StudioStoryTreeScene[] = [];
  for (const id of listChildIds(scenesDir, { files: true })) {
    const scene = tryReadSceneFile(path.join(scenesDir, `${id}.json`), id);
    if (scene) {
      scenes.push({ id: scene.id, title: scene.title, updatedAt: scene.updatedAt });
    }
  }

  return scenes.sort((left, right) => compareIds(left.id, right.id));
}

function tryReadSceneFile(filePath: string, sceneId: string): StudioScene | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const scene = parseJsonRecord(filePath, sceneRecordSchema);
    return scene.id === sceneId ? scene : null;
  } catch {
    return null;
  }
}

function tryReadEntityFile(filePath: string, entityId: string, kind: StudioEntityKind): StudioEntity | null {
  try {
    const entity = parseJsonRecord(filePath, entityRecordSchema);
    return entity.id === entityId && entity.kind === kind ? entity : null;
  } catch {
    return null;
  }
}

function writeDefaultProjectTree(projectDir: string, project: StudioProject, now: string): void {
  writeJsonFile(path.join(projectDir, "project.json"), project);
  writeJsonFile(path.join(projectDir, "content", "volumes", "volume-01", "volume.json"), {
    id: "volume-01",
    title: "Volume 1",
    updatedAt: now,
  } satisfies StudioVolume);
  writeJsonFile(
    path.join(projectDir, "content", "volumes", "volume-01", "chapters", "chapter-01", "chapter.json"),
    {
      id: "chapter-01",
      title: "Chapter 1",
      updatedAt: now,
    } satisfies StudioChapter,
  );
  writeJsonFile(
    path.join(projectDir, "content", "volumes", "volume-01", "chapters", "chapter-01", "scenes", "scene-01.json"),
    defaultScene("scene-01", "Untitled scene", now),
  );
  ensureDirectory(path.join(projectDir, "entities", "characters"));
  ensureDirectory(path.join(projectDir, "entities", "locations"));
  ensureDirectory(path.join(projectDir, "entities", "props"));
  ensureDirectory(path.join(projectDir, "entities", "costumes"));
  writeJsonFile(path.join(projectDir, "styles", "default.json"), {
    id: "default",
    label: "Default",
    visual: "",
    updatedAt: now,
  });
}

function defaultScene(id: string, title: string, updatedAt: string): StudioScene {
  return {
    id,
    title,
    script: "",
    intent: "",
    characters: [],
    location: null,
    props: [],
    costumes: [],
    shots: [],
    updatedAt,
  };
}

function projectFile(ctx: ProjectContext, ...segments: string[]): string {
  return constrainToWorkspaceRoot(ctx.root, path.resolve(ctx.projectDir, ...segments));
}

function entityKindDir(ctx: ProjectContext, kind: StudioEntityKind): string {
  return projectFile(ctx, "entities", ENTITY_KIND_DIRS[kind]);
}

function listChildIds(
  directoryPath: string,
  options: { directories?: boolean; files?: boolean },
): string[] {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  const ids: string[] = [];
  for (const entry of readDirSafe(directoryPath)) {
    if (options.directories && entryLooksLikeDirectory(directoryPath, entry)) {
      ids.push(entry.name);
      continue;
    }

    if (options.files && entry.isFile() && entry.name.endsWith(".json")) {
      ids.push(entry.name.slice(0, -".json".length));
    }
  }

  return ids;
}

function assertIdAvailable(existing: readonly string[], id: string): void {
  if (existing.includes(id)) {
    throw new StudioIdConflictError();
  }
}

function assertFresh(currentUpdatedAt: string, expectedUpdatedAt: string, current: unknown): void {
  if (currentUpdatedAt !== expectedUpdatedAt) {
    throw new StudioEditConflictError(current);
  }
}

function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = typeof issue?.path[0] === "string" ? issue.path[0] : undefined;
    throw new StudioValidationError(issue?.message ?? "Invalid input.", field);
  }
  return result.data;
}

function defaultNumberedTitle(prefix: string, label: string, id: string, fallback: string): string {
  const match = new RegExp(`^${prefix}-(\\d+)$`).exec(id);
  if (!match?.[1]) {
    return fallback;
  }
  return `${label} ${Number.parseInt(match[1], 10)}`;
}

function nowIso(previous?: string): string {
  const now = new Date().toISOString();
  if (previous && now <= previous) {
    const millis = Date.parse(previous);
    if (Number.isFinite(millis)) {
      return new Date(millis + 1).toISOString();
    }
  }
  return now;
}

function compareIds(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true });
}

function directoryExists(root: string, name: string): boolean {
  try {
    return fs.existsSync(path.join(root, name));
  } catch {
    return false;
  }
}

function readDirSafe(directoryPath: string): fs.Dirent[] {
  try {
    return fs.readdirSync(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isEnoent(error)) {
      return [];
    }
    throw error;
  }
}

function entryLooksLikeDirectory(parent: string, entry: fs.Dirent): boolean {
  if (entry.isDirectory()) {
    return true;
  }

  if (entry.isSymbolicLink()) {
    try {
      return fs.statSync(path.join(parent, entry.name)).isDirectory();
    } catch {
      return false;
    }
  }

  return false;
}

function removePathSafe(target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
}

type SceneArtifacts = {
  sceneIds: string[];
  shotIds: string[];
};

function collectSceneArtifacts(scene: StudioScene): SceneArtifacts {
  return {
    sceneIds: [scene.id],
    shotIds: scene.shots.map((shot) => shot.id),
  };
}

function collectChapterArtifacts(ctx: ChapterContext): SceneArtifacts {
  const scenesDir = path.join(ctx.chapterDir, "scenes");
  const sceneIds: string[] = [];
  const shotIds: string[] = [];

  for (const id of listChildIds(scenesDir, { files: true })) {
    const scene = tryReadSceneFile(path.join(scenesDir, `${id}.json`), id);
    if (scene) {
      sceneIds.push(scene.id);
      for (const shot of scene.shots) {
        shotIds.push(shot.id);
      }
    } else {
      sceneIds.push(id);
    }
  }

  return { sceneIds, shotIds };
}

function collectVolumeArtifacts(ctx: VolumeContext): SceneArtifacts {
  const chaptersDir = path.join(ctx.volumeDir, "chapters");
  const sceneIds: string[] = [];
  const shotIds: string[] = [];

  for (const chapterId of listChildIds(chaptersDir, { directories: true })) {
    try {
      assertStudioId(chapterId, "chapterId");
    } catch {
      continue;
    }

    const chapterDir = constrainToWorkspaceRoot(ctx.root, path.resolve(chaptersDir, chapterId));
    const scenesDir = path.join(chapterDir, "scenes");
    for (const sceneId of listChildIds(scenesDir, { files: true })) {
      const scene = tryReadSceneFile(path.join(scenesDir, `${sceneId}.json`), sceneId);
      if (scene) {
        sceneIds.push(scene.id);
        for (const shot of scene.shots) {
          shotIds.push(shot.id);
        }
      } else {
        sceneIds.push(sceneId);
      }
    }
  }

  return { sceneIds, shotIds };
}

function cleanupSceneArtifacts(ctx: ProjectContext, artifacts: SceneArtifacts): void {
  for (const sceneId of artifacts.sceneIds) {
    try {
      const id = assertStudioId(sceneId, "sceneId");
      removePathSafe(projectFile(ctx, "outputs", "images", id));
    } catch {
      // Ignore invalid ids left on disk; structure deletion already completed.
    }
  }

  for (const shotId of artifacts.shotIds) {
    try {
      deleteWorkflowNode(ctx.projectId, shotId);
    } catch {
      // Missing or invalid workflow node paths are non-fatal.
    }
  }
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "EEXIST" || error.code === "EPERM"),
  );
}

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
