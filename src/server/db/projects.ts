import "server-only";

import { randomUUID } from "node:crypto";
import { createProjectInputSchema, projectSchema, updateProjectInputSchema, type CreateProjectInput, type Project, type UpdateProjectInput } from "@/domain/project";
import { getDatabase } from "./connection";

type ProjectRow = {
  id: string;
  title: string;
  premise: string;
  genre: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

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

export function listProjects(options: { includeArchived?: boolean } = {}) {
  const database = getDatabase();
  const rows = options.includeArchived
    ? database.prepare("SELECT id, title, premise, genre, status, created_at, updated_at FROM projects ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC").all()
    : database.prepare("SELECT id, title, premise, genre, status, created_at, updated_at FROM projects WHERE status = 'active' ORDER BY updated_at DESC").all();

  return (rows as unknown as ProjectRow[]).map(toProject);
}

export function getProjectById(id: string) {
  const row = getDatabase()
    .prepare("SELECT id, title, premise, genre, status, created_at, updated_at FROM projects WHERE id = :id")
    .get({ id }) as unknown as ProjectRow | undefined;

  return row ? toProject(row) : null;
}

export function createProject(input: CreateProjectInput) {
  const values = createProjectInputSchema.parse(input);
  const id = randomUUID();
  const now = new Date().toISOString();

  getDatabase()
    .prepare("INSERT INTO projects (id, title, premise, genre, status, created_at, updated_at) VALUES (:id, :title, :premise, :genre, 'active', :createdAt, :updatedAt)")
    .run({
      id,
      title: values.title,
      premise: values.premise,
      genre: values.genre,
      createdAt: now,
      updatedAt: now,
    });

  return getProjectById(id) as Project;
}

export function updateProject(id: string, input: UpdateProjectInput) {
  const values = updateProjectInputSchema.parse(input);
  const fields: string[] = [];
  const parameters: Record<string, string> = { id };

  if (values.title !== undefined) {
    fields.push("title = :title");
    parameters.title = values.title;
  }
  if (values.premise !== undefined) {
    fields.push("premise = :premise");
    parameters.premise = values.premise;
  }
  if (values.genre !== undefined) {
    fields.push("genre = :genre");
    parameters.genre = values.genre;
  }
  if (values.status !== undefined) {
    fields.push("status = :status");
    parameters.status = values.status;
  }

  fields.push("updated_at = :updatedAt");
  parameters.updatedAt = new Date().toISOString();

  const result = getDatabase()
    .prepare(`UPDATE projects SET ${fields.join(", ")} WHERE id = :id`)
    .run(parameters);

  if (result.changes === 0) {
    return null;
  }

  return getProjectById(id);
}

export function archiveProject(id: string) {
  return updateProject(id, { status: "archived" });
}

export const projectRepository = {
  listProjects,
  getProjectById,
  createProject,
  updateProject,
  archiveProject,
};
