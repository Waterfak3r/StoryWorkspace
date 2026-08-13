import { describe, expect, it } from "vitest";
import { GET as getReferenceAssets, POST as postReferenceAsset } from "./projects/[projectId]/reference-assets/route";
import { POST as postCompile } from "./projects/[projectId]/shots/[shotSpecId]/compile/route";
import { GET as getCompiledRequest } from "./projects/[projectId]/compiled-requests/[compiledRequestId]/route";

const projectId = "11111111-1111-4111-8111-111111111111";
const shotSpecId = "22222222-2222-4222-8222-222222222222";
const compiledRequestId = "33333333-3333-4333-8333-333333333333";

function context<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

async function jsonResponse(response: Response) {
  return { status: response.status, body: await response.json() as unknown };
}

describe("Phase 5B route contracts", () => {
  it("rejects unknown query/body fields with the standard error envelope", async () => {
    const get = await jsonResponse(await getReferenceAssets(new Request(`http://localhost/api/projects/${projectId}/reference-assets?unexpected=true`), context({ projectId })));
    expect(get.status).toBe(400);
    expect(get.body).toMatchObject({ error: { code: "VALIDATION_ERROR", retryable: false, fieldErrors: expect.any(Object) } });

    const post = await jsonResponse(await postReferenceAsset(new Request("http://localhost", { method: "POST", body: JSON.stringify({ entityId: shotSpecId, label: "x", requestId: "r", unexpected: true }) }), context({ projectId })));
    expect(post.status).toBe(400);
    expect(post.body).toMatchObject({ error: { code: "VALIDATION_ERROR", retryable: false } });

    const compile = await jsonResponse(await postCompile(new Request("http://localhost", { method: "POST", body: JSON.stringify({ requestId: "r", unexpected: true }) }), context({ projectId, shotSpecId })));
    expect(compile.status).toBe(400);
    expect(compile.body).toMatchObject({ error: { code: "VALIDATION_ERROR", retryable: false } });
  });

  it("validates UUID route params before touching persistence", async () => {
    const response = await jsonResponse(await getCompiledRequest(new Request("http://localhost"), context({ projectId: "not-a-uuid", compiledRequestId })));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: "VALIDATION_ERROR", retryable: false } });
  });
});
