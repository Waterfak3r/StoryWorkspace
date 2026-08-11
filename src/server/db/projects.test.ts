import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let databaseDirectory = "";

async function repository() {
  return import("./projects");
}

describe("project repository", () => {
  beforeEach(() => {
    databaseDirectory = mkdtempSync(join(tmpdir(), "story-workspace-"));
    process.env.STORY_WORKSPACE_DB_PATH = join(databaseDirectory, "projects.db");
  });

  afterEach(async () => {
    const { closeDatabase } = await import("./connection");
    closeDatabase();
    delete process.env.STORY_WORKSPACE_DB_PATH;
    rmSync(databaseDirectory, { recursive: true, force: true });
  });

  it("creates and reads a project with stable ISO timestamps", async () => {
    const { createProject, getProjectById, listProjects } = await repository();
    const project = createProject({ title: "A Small Weather", genre: "Literary" });

    expect(project.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(project.title).toBe("A Small Weather");
    expect(project.status).toBe("active");
    expect(project.createdAt).toEqual(project.updatedAt);
    expect(getProjectById(project.id)).toEqual(project);
    expect(listProjects()).toHaveLength(1);
  });

  it("renames and archives a project without removing its record", async () => {
    const { archiveProject, createProject, getProjectById, listProjects, updateProject } = await repository();
    const project = createProject({ title: "Draft One" });
    const renamed = updateProject(project.id, { title: "Draft Two" });

    expect(renamed?.title).toBe("Draft Two");
    expect(archiveProject(project.id)?.status).toBe("archived");
    expect(listProjects()).toHaveLength(0);
    expect(listProjects({ includeArchived: true })).toHaveLength(1);
    expect(getProjectById(project.id)?.title).toBe("Draft Two");
  });

  it("persists records after the database connection is recreated", async () => {
    const { createProject } = await repository();
    const project = createProject({ title: "Across Restarts" });
    const { closeDatabase } = await import("./connection");
    closeDatabase();

    const fresh = await repository();
    expect(fresh.getProjectById(project.id)?.title).toBe("Across Restarts");
  });
});
