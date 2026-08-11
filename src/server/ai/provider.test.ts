import { afterEach, describe, expect, it, vi } from "vitest";
import { generateAiMarkdown, parseResponsesMarkdown } from "./provider";

const prompt = { system: "system", user: "user" };

afterEach(() => {
  vi.useRealTimers();
});

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("AI provider adapter", () => {
  it("walks every message output and sends private structured requests", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      status: "completed",
      output: [
        { type: "reasoning", content: [{ type: "output_text", text: "ignore me" }] },
        { type: "message", content: [{ type: "output_text", text: "{\"markdown\":" }] },
        { type: "message", content: [{ type: "output_text", text: "\"A draft\"}" }] },
      ],
    }));

    await expect(generateAiMarkdown(prompt, {
      baseUrl: "https://provider.example/v1/",
      apiKey: "secret",
      model: "story-model",
      fetchImpl,
    })).resolves.toBe("A draft");

    expect(fetchImpl).toHaveBeenCalledWith("https://provider.example/v1/responses", expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer secret" },
    }));
    const request = JSON.parse(fetchImpl.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(request.store).toBe(false);
    expect(request.max_output_tokens).toBe(7000);
    expect(request.text).toMatchObject({ format: { type: "json_schema", strict: true } });
    expect(JSON.stringify(request.text)).not.toContain("maxLength");
  });

  it("only treats token-limit incomplete responses as truncated", () => {
    for (const reason of ["max_tokens", "max_output_tokens"]) {
      expect(() => parseResponsesMarkdown({ status: "incomplete", incomplete_details: { reason }, output_text: "{\"markdown\":\"draft\"}" })).toThrow(/truncated/i);
      expect(() => parseResponsesMarkdown({ status: "incomplete", incomplete_details: { reason }, output_text: "{\"markdown\":\"draft\"}" })).toThrow(expect.objectContaining({ retryable: false }));
    }
    for (const incompleteDetails of [undefined, { reason: "content_filter" }, { reason: "other" }]) {
      expect(() => parseResponsesMarkdown({ status: "incomplete", incomplete_details: incompleteDetails, output_text: "{\"markdown\":\"draft\"}" })).toThrow(/invalid draft/i);
      expect(() => parseResponsesMarkdown({ status: "incomplete", incomplete_details: incompleteDetails, output_text: "{\"markdown\":\"draft\"}" })).toThrow(expect.objectContaining({ retryable: true }));
    }
  });

  it("rejects malformed, empty, and oversized provider output", () => {
    expect(() => parseResponsesMarkdown({ output_text: "{\"markdown\":\"   \"}" })).toThrow(/invalid draft/i);
    expect(() => parseResponsesMarkdown({ output_text: "not json" })).toThrow(/invalid draft/i);
    expect(() => parseResponsesMarkdown({ output_text: JSON.stringify({ markdown: "x".repeat(30_001) }) })).toThrow(expect.objectContaining({ retryable: false }));
  });

  it("rejects an oversized raw provider response before parsing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("x".repeat(256 * 1024 + 1), { status: 200 }));
    await expect(generateAiMarkdown(prompt, { apiKey: "secret", model: "story-model", fetchImpl })).rejects.toMatchObject({
      code: "AI_INVALID_RESPONSE",
    });
  });

  it("returns a stable configuration error without calling fetch", async () => {
    const fetchImpl = vi.fn();
    await expect(generateAiMarkdown(prompt, { fetchImpl })).rejects.toMatchObject({
      code: "AI_NOT_CONFIGURED",
      status: 503,
      retryable: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps provider status and network failures to stable errors", async () => {
    for (const [status, code] of [[401, "AI_AUTHENTICATION_ERROR"], [403, "AI_AUTHENTICATION_ERROR"], [429, "AI_RATE_LIMITED"], [500, "AI_PROVIDER_ERROR"]] as const) {
      const fetchImpl = vi.fn().mockResolvedValue(new Response("provider error", { status }));
      await expect(generateAiMarkdown(prompt, { apiKey: "secret", model: "story-model", fetchImpl })).rejects.toMatchObject({ code });
    }
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(generateAiMarkdown(prompt, { apiKey: "secret", model: "story-model", fetchImpl })).rejects.toMatchObject({ code: "AI_PROVIDER_ERROR" });
  });

  it("maps an adapter timeout to a retryable timeout error", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "AbortError")), { once: true });
    }));
    const pending = generateAiMarkdown(prompt, { apiKey: "secret", model: "story-model", fetchImpl, timeoutMs: 5 });
    const assertion = expect(pending).rejects.toMatchObject({ code: "AI_TIMEOUT", retryable: true });
    await vi.advanceTimersByTimeAsync(5);
    await assertion;
  });

  it("maps caller cancellation without persisting or exposing provider details", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(generateAiMarkdown(prompt, { apiKey: "secret", model: "story-model", fetchImpl }, controller.signal)).rejects.toMatchObject({
      code: "AI_CANCELLED",
      status: 499,
    });
  });
});
