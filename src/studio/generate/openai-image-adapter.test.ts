import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { StudioAiError } from "../errors";
import { createProject, getWorkspaceRoot } from "../fs";
import { withImageAdapterRetry } from "./adapter";
import { FAKE_PNG_BYTES } from "./fake-image-adapter";
import { openaiCompatibleImageAdapter } from "./openai-image-adapter";

const ENV_KEYS = [
  "STORY_WORKSPACE_ROOT",
  "STORY_WORKSPACE_DB_PATH",
  "STORY_USER_CONFIG",
  "IMAGE_BASE_URL",
  "IMAGE_API_KEY",
  "IMAGE_MODEL",
  "IMAGE_SIZE",
  "IMAGE_QUALITY",
  "AI_API_KEY",
  "AI_MODEL",
] as const;

const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as Record<
  (typeof ENV_KEYS)[number],
  string | undefined
>;

const TEST_IMAGE_KEY = "sk-test-image-key-wxyz";
const originalFetch = globalThis.fetch;

let workspaceRoot = "";
let userConfigDir = "";
let projectId = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-openai-image-"));
  userConfigDir = mkdtempSync(path.join(tmpdir(), "studio-openai-image-user-"));
  process.env.STORY_WORKSPACE_ROOT = workspaceRoot;
  process.env.STORY_USER_CONFIG = path.join(userConfigDir, "providers.json");
  delete process.env.STORY_WORKSPACE_DB_PATH;
  process.env.IMAGE_BASE_URL = "https://naapi.cc/v1";
  process.env.IMAGE_API_KEY = TEST_IMAGE_KEY;
  process.env.IMAGE_MODEL = "gpt-image-2";
  process.env.IMAGE_SIZE = "3840x2160";
  process.env.IMAGE_QUALITY = "high";
  delete process.env.AI_API_KEY;
  delete process.env.AI_MODEL;

  const project = createProject({ title: "Harbor Night" });
  projectId = project.id;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  rmSync(workspaceRoot, { recursive: true, force: true });
  rmSync(userConfigDir, { recursive: true, force: true });

  for (const key of ENV_KEYS) {
    const previous = previousEnv[key];
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
});

function adapterInput() {
  return {
    projectId,
    sceneId: "scene-01",
    shotId: "shot-01",
    runId: "run-01",
    prompt: "Wide harbor night establishing shot",
    provider: {
      model: "gpt-image-2",
      size: "3840x2160",
      quality: "high",
    },
  };
}

describe("openaiCompatibleImageAdapter", () => {
  it("POSTs the 4K NaAPI body with Bearer auth and writes decoded b64_json", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toBe("https://naapi.cc/v1/images/generations");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${TEST_IMAGE_KEY}`);
      expect(headers.get("content-type")).toContain("application/json");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toEqual({
        model: "gpt-image-2",
        prompt: "Wide harbor night establishing shot",
        size: "1536x1024",
        quality: "high",
        n: 1,
        response_format: "b64_json",
        moderation: "low",
      });
      return new Response(
        JSON.stringify({
          data: [{ b64_json: FAKE_PNG_BYTES.toString("base64") }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await openaiCompatibleImageAdapter(adapterInput());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.relativePath).toBe("outputs/images/scene-01/shot-01/run-01.png");
    const absolute = path.join(getWorkspaceRoot(), projectId, ...result.relativePath.split("/"));
    expect(existsSync(absolute)).toBe(true);
    expect(readFileSync(absolute).equals(FAKE_PNG_BYTES)).toBe(true);
  });

  it("POSTs /images/edits with the actual reference image bytes when refs exist", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://naapi.cc/v1/images/edits");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${TEST_IMAGE_KEY}`);
      expect(headers.get("content-type") ?? "").not.toContain("application/json");
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect(form.get("prompt")).toBe("Keep Sue identical");
      expect(form.get("model")).toBe("gpt-image-2");
      const image = form.get("image");
      expect(image).toBeInstanceOf(Blob);
      const bytes = Buffer.from(await (image as Blob).arrayBuffer());
      expect(bytes.equals(FAKE_PNG_BYTES)).toBe(true);
      expect(bytes.toString("utf8")).not.toContain("assets/images/");
      return new Response(
        JSON.stringify({
          data: [{ b64_json: FAKE_PNG_BYTES.toString("base64") }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await openaiCompatibleImageAdapter({
      ...adapterInput(),
      prompt: "Keep Sue identical",
      referenceImages: [
        {
          filename: "character-01-ref-01.png",
          mime: "image/png",
          bytes: FAKE_PNG_BYTES,
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.relativePath).toBe("outputs/images/scene-01/shot-01/run-01.png");
  });

  it("maps HTTP 400 provider error.message and marks it non-retryable", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "balance low" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    ) as typeof fetch;

    await expect(openaiCompatibleImageAdapter(adapterInput())).rejects.toMatchObject({
      name: "StudioAiError",
      message: expect.stringContaining("balance low"),
      retryable: false,
    });
  });
});

describe("withImageAdapterRetry", () => {
  it("attempts a non-retryable error only once", async () => {
    const adapter = vi.fn(async () => {
      throw new StudioAiError("AI_PROVIDER_ERROR", "balance low", 502, false);
    });
    const wrapped = withImageAdapterRetry(adapter, 2);

    await expect(wrapped(adapterInput())).rejects.toMatchObject({
      message: "balance low",
      retryable: false,
    });
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it("retries a retryable error and can succeed on the second try", async () => {
    const adapter = vi
      .fn()
      .mockRejectedValueOnce(new StudioAiError("AI_PROVIDER_ERROR", "temporary", 502, true))
      .mockResolvedValueOnce({ relativePath: "outputs/images/scene-01/shot-01/run-01.png" });
    const wrapped = withImageAdapterRetry(adapter, 2);

    await expect(wrapped(adapterInput())).resolves.toEqual({
      relativePath: "outputs/images/scene-01/shot-01/run-01.png",
    });
    expect(adapter).toHaveBeenCalledTimes(2);
  });
});
