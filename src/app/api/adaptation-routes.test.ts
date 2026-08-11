import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

let databaseDirectory = "";

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function routeContext<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

describe("adaptation and export routes", () => {
  beforeEach(() => {
    databaseDirectory = mkdtempSync(join(tmpdir(), "story-adaptation-api-"));
    process.env.STORY_WORKSPACE_DB_PATH = join(databaseDirectory, "story.db");
  });

  afterEach(async () => {
    const { closeDatabase } = await import("@/server/db/connection");
    closeDatabase();
    delete process.env.STORY_WORKSPACE_DB_PATH;
    rmSync(databaseDirectory, { recursive: true, force: true });
  });

  it("creates, lists, updates with CAS, and deletes manual adaptations", async () => {
    const { createProject } = await import("@/server/db/projects");
    const project = createProject({ title: "Adaptation routes" });
    const { GET: listRoute, POST: createRoute } = await import("./projects/[projectId]/adaptations/route");
    const createdResponse = await createRoute(
      jsonRequest("http://localhost/api/projects/adaptations", "POST", { origin: "manual", format: "screenplay_scene", title: "Scene", body: "INT. ROOM" }),
      routeContext({ projectId: project.id }),
    );
    expect(createdResponse.status).toBe(201);
    const adaptation = (await createdResponse.json()).data.adaptation as { id: string; updatedAt: string; body: string };
    expect(adaptation.body).toBe("INT. ROOM");

    const listResponse = await listRoute(new Request("http://localhost/api/projects/adaptations"), routeContext({ projectId: project.id }));
    expect((await listResponse.json()).data.adaptations).toHaveLength(1);

    const { PATCH, DELETE, GET } = await import("./adaptations/[adaptationId]/route");
    const updatedResponse = await PATCH(
      jsonRequest("http://localhost/api/adaptations/one", "PATCH", { baseUpdatedAt: adaptation.updatedAt, body: "INT. ROOM - NIGHT" }),
      routeContext({ adaptationId: adaptation.id }),
    );
    expect(updatedResponse.status).toBe(200);
    const updated = (await updatedResponse.json()).data.adaptation as { updatedAt: string };
    const staleResponse = await PATCH(
      jsonRequest("http://localhost/api/adaptations/one", "PATCH", { baseUpdatedAt: adaptation.updatedAt, body: "Stale" }),
      routeContext({ adaptationId: adaptation.id }),
    );
    expect(staleResponse.status).toBe(409);
    const stalePayload = await staleResponse.json();
    expect(stalePayload.error).toMatchObject({ code: "EDIT_CONFLICT", retryable: false });
    expect(stalePayload.error.currentAdaptation.updatedAt).toBe(updated.updatedAt);

    const readResponse = await GET(new Request("http://localhost/api/adaptations/one"), routeContext({ adaptationId: adaptation.id }));
    expect((await readResponse.json()).data.adaptation.body).toBe("INT. ROOM - NIGHT");
    const deleteResponse = await DELETE(new Request("http://localhost/api/adaptations/one", { method: "DELETE" }), routeContext({ adaptationId: adaptation.id }));
    expect(deleteResponse.status).toBe(200);
    const missingResponse = await GET(new Request("http://localhost/api/adaptations/one"), routeContext({ adaptationId: adaptation.id }));
    expect(missingResponse.status).toBe(404);
  });

  it("copies only a same-project adapt generation and rejects duplicates or forged fields", async () => {
    const { createProject } = await import("@/server/db/projects");
    const { createNarrativeRepository } = await import("@/server/db/narrative");
    const project = createProject({ title: "AI adaptation routes" });
    const otherProject = createProject({ title: "Other" });
    const repository = createNarrativeRepository();
    const chapter = repository.createChapter(project.id, { title: "Target", body: "Draft" });
    const foreignChapter = repository.createChapter(otherProject.id, { title: "Foreign", body: "Draft" });
    const generation = repository.createAiGeneration({ projectId: project.id, targetChapterId: chapter.id, action: "adapt", instruction: "Adapt", contextReferenceIds: [], generatedMarkdown: "Server generated scene" });
    const foreignGeneration = repository.createAiGeneration({ projectId: otherProject.id, targetChapterId: foreignChapter.id, action: "adapt", instruction: "Adapt", contextReferenceIds: [], generatedMarkdown: "Foreign" });
    const { POST } = await import("./projects/[projectId]/adaptations/route");

    const forgedResponse = await POST(
      jsonRequest("http://localhost/api/projects/adaptations", "POST", { origin: "ai", format: "screenplay_scene", title: "Forged", generationId: generation.id, body: "Browser body" }),
      routeContext({ projectId: project.id }),
    );
    expect(forgedResponse.status).toBe(400);

    const foreignResponse = await POST(
      jsonRequest("http://localhost/api/projects/adaptations", "POST", { origin: "ai", format: "screenplay_scene", title: "Foreign", generationId: foreignGeneration.id }),
      routeContext({ projectId: project.id }),
    );
    expect(foreignResponse.status).toBe(404);

    const createdResponse = await POST(
      jsonRequest("http://localhost/api/projects/adaptations", "POST", { origin: "ai", format: "screenplay_scene", title: "Trusted", generationId: generation.id }),
      routeContext({ projectId: project.id }),
    );
    expect(createdResponse.status).toBe(201);
    const createdPayload = await createdResponse.json() as { data: { adaptation: { id: string; body: string; sourceGenerationId: string } } };
    expect(createdPayload.data.adaptation).toMatchObject({ body: "Server generated scene", sourceGenerationId: generation.id });

    const duplicateResponse = await POST(
      jsonRequest("http://localhost/api/projects/adaptations", "POST", { origin: "ai", format: "screenplay_scene", title: "Duplicate", generationId: generation.id }),
      routeContext({ projectId: project.id }),
    );
    expect(duplicateResponse.status).toBe(409);
    expect((await duplicateResponse.json()).error).toMatchObject({
      code: "AI_GENERATION_ALREADY_CONSUMED",
      consumedBy: "adaptation",
      retryable: false,
    });
    const duplicateAgain = await POST(
      jsonRequest("http://localhost/api/projects/adaptations", "POST", { origin: "ai", format: "screenplay_scene", title: "Duplicate again", generationId: generation.id }),
      routeContext({ projectId: project.id }),
    );
    expect((await duplicateAgain.json()).error.currentAdaptation.id).toBe(createdPayload.data.adaptation.id);
  });

  it("returns a raw deterministic Markdown attachment and JSON 404", async () => {
    const { createProject } = await import("@/server/db/projects");
    const { createNarrativeRepository } = await import("@/server/db/narrative");
    const project = createProject({ title: "Export / title", premise: "A premise", genre: "Drama" });
    const repository = createNarrativeRepository();
    repository.createBibleEntry(project.id, { category: "world", title: "Setting", body: "A town" });
    repository.createChapter(project.id, { title: "Chapter", body: "Body" });
    repository.createAdaptation(project.id, { origin: "manual", format: "screenplay_scene", title: "Scene", body: "INT. TOWN" });

    const { GET } = await import("./projects/[projectId]/export/route");
    const response = await GET(new Request("http://localhost/api/projects/export"), routeContext({ projectId: project.id }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("content-disposition")).toMatch(/filename="story-workspace-export\.md"/);
    const body = await response.text();
    expect(body).toContain("# Export / title");
    expect(body).toContain("## Adaptations");
    expect(body).not.toContain("\r");

    const missing = await GET(new Request("http://localhost/api/projects/export"), routeContext({ projectId: randomUUID() }));
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("NOT_FOUND");
  });
});
