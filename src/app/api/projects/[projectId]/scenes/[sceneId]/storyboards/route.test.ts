import { describe, expect, it } from "vitest";
import { GET as listStoryboards, POST as createStoryboard } from "./route";
import { GET as getStoryboard } from "../../../storyboards/[storyboardId]/route";
import { POST as approveStoryboard } from "../../../storyboards/[storyboardId]/approve/route";

const projectId = "11111111-1111-4111-8111-111111111111";
const sceneId = "22222222-2222-4222-8222-222222222222";
const storyboardId = "33333333-3333-4333-8333-333333333333";

describe("Phase 5A Storyboard routes", () => {
  it("rejects unknown list filters and malformed path parameters", async () => {
    const queryResponse = await listStoryboards(
      new Request(`http://localhost/api/projects/${projectId}/scenes/${sceneId}/storyboards?unknown=value`),
      { params: Promise.resolve({ projectId, sceneId }) },
    );
    expect(queryResponse.status).toBe(400);
    await expect(queryResponse.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR", retryable: false } });

    const pathResponse = await getStoryboard(
      new Request("http://localhost/api/projects/not-a-uuid/storyboards/not-a-uuid"),
      { params: Promise.resolve({ projectId: "not-a-uuid", storyboardId: "not-a-uuid" }) },
    );
    expect(pathResponse.status).toBe(400);
  });

  it("rejects unknown create and approve fields before database access", async () => {
    const createResponse = await createStoryboard(
      new Request(`http://localhost/api/projects/${projectId}/scenes/${sceneId}/storyboards`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contextSnapshotId: storyboardId, title: "Invalid", shots: [], requestId: "request", unknown: true }),
      }),
      { params: Promise.resolve({ projectId, sceneId }) },
    );
    expect(createResponse.status).toBe(400);
    await expect(createResponse.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR", fieldErrors: { _form: expect.arrayContaining([expect.stringMatching(/unknown/i)]) } } });

    const approveResponse = await approveStoryboard(
      new Request(`http://localhost/api/projects/${projectId}/storyboards/${storyboardId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: 1, requestId: "approve", extra: true }),
      }),
      { params: Promise.resolve({ projectId, storyboardId }) },
    );
    expect(approveResponse.status).toBe(400);
    await expect(approveResponse.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR", fieldErrors: { _form: expect.arrayContaining([expect.stringMatching(/extra/i)]) } } });
  });
});
