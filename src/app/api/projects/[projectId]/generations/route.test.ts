import { describe, expect, it } from "vitest";
import { POST as submitGeneration } from "./route";
import { GET as getGeneration } from "./[manifestId]/route";
import { POST as retryGeneration } from "../generation-jobs/[jobId]/retry/route";

const projectId = "11111111-1111-4111-8111-111111111111";
const manifestId = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";
const compiledRequestId = "44444444-4444-4444-8444-444444444444";

function jsonRequest(url: string, body: unknown) {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("Phase 5C generation routes", () => {
  it("rejects unknown body fields and malformed paths with strict envelopes", async () => {
    const submitResponse = await submitGeneration(
      jsonRequest(`http://localhost/api/projects/${projectId}/generations`, { compiledRequestId, requestId: "submit", extra: true }),
      { params: Promise.resolve({ projectId }) },
    );
    expect(submitResponse.status).toBe(400);
    await expect(submitResponse.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR", retryable: false } });

    const retryResponse = await retryGeneration(
      jsonRequest(`http://localhost/api/projects/${projectId}/generation-jobs/${jobId}/retry`, { expectedVersion: 1, requestId: "retry", extra: true }),
      { params: Promise.resolve({ projectId, jobId }) },
    );
    expect(retryResponse.status).toBe(400);

    const getResponse = await getGeneration(
      new Request("http://localhost/api/projects/not-a-uuid/generations/not-a-uuid?unknown=value"),
      { params: Promise.resolve({ projectId: "not-a-uuid", manifestId: "not-a-uuid" }) },
    );
    expect(getResponse.status).toBe(400);
    await expect(getResponse.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const validPathQueryResponse = await getGeneration(
      new Request(`http://localhost/api/projects/${projectId}/generations/${manifestId}?unknown=value`),
      { params: Promise.resolve({ projectId, manifestId }) },
    );
    expect(validPathQueryResponse.status).toBe(400);
  });
});
