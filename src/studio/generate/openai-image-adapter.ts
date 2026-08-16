import "server-only";

import { StudioAiError } from "../errors";
import { resolveImageProvider } from "../settings";
import type { ImageAdapterInput, ImageAdapterResult } from "./adapter";
import { writeShotImageFile } from "./image-output";

const MAX_IMAGE_PAYLOAD_BYTES = 40 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 300_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function providerErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return undefined;
  }
  const message = payload.error.message;
  if (typeof message !== "string") {
    return undefined;
  }
  const trimmed = message.trim();
  return trimmed || undefined;
}

function errorForStatus(status: number, providerMessage?: string) {
  if (status === 401 || status === 403) {
    return new StudioAiError(
      "AI_AUTHENTICATION_ERROR",
      providerMessage ?? "The image provider rejected the configured credentials.",
      502,
      false,
    );
  }
  if (status === 429) {
    return new StudioAiError(
      "AI_RATE_LIMITED",
      providerMessage ?? "The image provider is rate limited. Try again shortly.",
      429,
      false,
    );
  }
  if (status === 400) {
    return new StudioAiError(
      "AI_PROVIDER_ERROR",
      providerMessage ?? "The image provider could not complete this request. Try again.",
      502,
      false,
    );
  }
  if (status === 408 || status === 504) {
    return new StudioAiError(
      "AI_TIMEOUT",
      providerMessage ?? "The image provider took too long to respond. Try again.",
      504,
      true,
    );
  }
  return new StudioAiError(
    "AI_PROVIDER_ERROR",
    providerMessage ?? "The image provider could not complete this request. Try again.",
    502,
    true,
  );
}

function invalidResponse() {
  return new StudioAiError("AI_INVALID_RESPONSE", "The image provider returned an invalid result. Try again.", 502, true);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (timedOut) {
      throw new StudioAiError("AI_TIMEOUT", "The image provider took too long to respond. Try again.", 504, true);
    }
    return response;
  } catch (error) {
    if (error instanceof StudioAiError) {
      throw error;
    }
    if (timedOut) {
      throw new StudioAiError("AI_TIMEOUT", "The image provider took too long to respond. Try again.", 504, true);
    }
    throw new StudioAiError("AI_PROVIDER_ERROR", "The image provider could not be reached. Try again.", 502, true);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function bytesFromGenerationPayload(payload: unknown): Promise<Buffer> {
  if (!isRecord(payload) || !Array.isArray(payload.data) || payload.data.length === 0) {
    throw invalidResponse();
  }

  const first = payload.data[0];
  if (!isRecord(first)) {
    throw invalidResponse();
  }

  if (typeof first.b64_json === "string" && first.b64_json.trim()) {
    const bytes = Buffer.from(first.b64_json, "base64");
    if (bytes.length === 0) {
      throw invalidResponse();
    }
    return bytes;
  }

  if (typeof first.url === "string" && first.url.trim()) {
    const response = await fetchWithTimeout(first.url.trim(), { method: "GET" });
    if (!response.ok) {
      throw await errorFromHttpResponse(response);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_IMAGE_PAYLOAD_BYTES) {
      throw invalidResponse();
    }
    return buffer;
  }

  throw invalidResponse();
}

async function errorFromHttpResponse(response: Response): Promise<StudioAiError> {
  let providerMessage: string | undefined;
  try {
    const raw = await response.text();
    if (raw.trim()) {
      providerMessage = providerErrorMessage(JSON.parse(raw) as unknown);
    }
  } catch {
    providerMessage = undefined;
  }
  return errorForStatus(response.status, providerMessage);
}

export async function openaiCompatibleImageAdapter(input: ImageAdapterInput): Promise<ImageAdapterResult> {
  const image = resolveImageProvider();
  if (!image.apiKey || !image.model) {
    throw new StudioAiError("AI_NOT_CONFIGURED", "Image generation is not configured for this workspace.", 503, false);
  }

  const model = input.provider.model.trim() || image.model;
  const size = input.provider.size.trim() || image.size;
  const quality = input.provider.quality.trim() || image.quality;
  const response = await fetchWithTimeout(`${image.baseUrl.replace(/\/+$/, "")}/images/generations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${image.apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt: input.prompt,
      size,
      quality,
      n: 1,
      response_format: "b64_json",
      moderation: "low",
    }),
  });

  if (!response.ok) {
    throw await errorFromHttpResponse(response);
  }

  const rawPayload = await response.text();
  if (rawPayload.length > MAX_IMAGE_PAYLOAD_BYTES) {
    throw invalidResponse();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawPayload) as unknown;
  } catch {
    throw invalidResponse();
  }

  const bytes = await bytesFromGenerationPayload(payload);
  return writeShotImageFile(input, bytes);
}
