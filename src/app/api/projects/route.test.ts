import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let databaseDirectory = "";

describe("GET /api/projects", () => {
  beforeEach(() => {
    databaseDirectory = mkdtempSync(join(tmpdir(), "story-workspace-api-"));
    process.env.STORY_WORKSPACE_DB_PATH = join(databaseDirectory, "projects.db");
  });

  afterEach(async () => {
    const { closeDatabase } = await import("@/server/db/connection");
    closeDatabase();
    delete process.env.STORY_WORKSPACE_DB_PATH;
    rmSync(databaseDirectory, { recursive: true, force: true });
  });

  it("excludes archived projects by default and includes them explicitly", async () => {
    const { archiveProject, createProject } = await import("@/server/db/projects");
    const { GET } = await import("./route");
    const active = createProject({ title: "Visible Draft" });
    const archived = createProject({ title: "Stored Draft" });
    archiveProject(archived.id);

    const defaultResponse = GET(new Request("http://localhost/api/projects"));
    const defaultPayload = await defaultResponse.json();
    expect(defaultResponse.status).toBe(200);
    expect(defaultPayload.data.projects.map((project: { id: string }) => project.id)).toEqual([active.id]);

    const allResponse = GET(new Request("http://localhost/api/projects?includeArchived=true"));
    const allPayload = await allResponse.json();
    expect(allPayload.data.projects.map((project: { id: string }) => project.id)).toEqual([active.id, archived.id]);
  });
});
