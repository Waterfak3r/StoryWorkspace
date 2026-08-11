import "server-only";

import { z } from "zod";
import { AI_LIMITS } from "@/domain/ai";
import type { AiPrompt } from "./prompt";

export type AiProviderErrorCode =
  | "AI_NOT_CONFIGURED"
  | "AI_TIMEOUT"
  | "AI_AUTHENTICATION_ERROR"
  | "AI_RATE_LIMITED"
  | "AI_PROVIDER_ERROR"
  | "AI_INVALID_RESPONSE"
  | "AI_CANCELLED";

export class AiProviderError extends Error {
  readonly code: AiProviderErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: AiProviderErrorCode, message: string, status: number, retryable: boolean) {
    super(message);
    this.name = "AiProviderError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export type AiProviderOptions = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const providerResponseSchema = z.object({
  markdown: z.string().max(AI_LIMITS.generatedMarkdown).refine((value) => value.trim().length > 0, {
    message: "Generated Markdown must not be empty",
  }),
}).strict();

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    markdown: { type: "string" },
  },
  required: ["markdown"],
};
const MAX_PROVIDER_PAYLOAD_BYTES = 256 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function configuredValue(value: string | undefined) {
  return value?.trim() || undefined;
}

function invalidResponse(message = "The AI provider returned an invalid draft. Try again.", retryable = true) {
  return new AiProviderError("AI_INVALID_RESPONSE", message, 502, retryable);
}

function outputTooLongResponse() {
  return invalidResponse("The AI draft is too long. Ask for a shorter draft and try again.", false);
}

function incompleteResponse() {
  return invalidResponse("The AI draft was truncated. Ask for a shorter draft and try again.", false);
}

export function parseResponsesMarkdown(payload: unknown) {
  if (!isRecord(payload)) {
    throw invalidResponse();
  }
  if (payload.status !== undefined && payload.status !== "completed") {
    if (payload.status === "incomplete") {
      const incompleteDetails = isRecord(payload.incomplete_details) ? payload.incomplete_details : null;
      const reason = incompleteDetails && typeof incompleteDetails.reason === "string"
        ? incompleteDetails.reason
        : null;
      if (reason === "max_tokens" || reason === "max_output_tokens") {
        throw incompleteResponse();
      }
    }
    throw invalidResponse();
  }

  const output = payload.output;
  const textParts: string[] = [];
  if (Array.isArray(output)) {
    for (const item of output) {
      if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) {
        continue;
      }
      for (const content of item.content) {
        if (isRecord(content) && content.type === "output_text" && typeof content.text === "string") {
          textParts.push(content.text);
        }
      }
    }
  }
  if (textParts.length === 0 && typeof payload.output_text === "string") {
    textParts.push(payload.output_text);
  }
  if (textParts.length === 0) {
    throw invalidResponse();
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(textParts.join(""));
  } catch {
    throw invalidResponse();
  }
  if (isRecord(decoded) && typeof decoded.markdown === "string" && decoded.markdown.length > AI_LIMITS.generatedMarkdown) {
    throw outputTooLongResponse();
  }
  const parsed = providerResponseSchema.safeParse(decoded);
  if (!parsed.success) {
    throw invalidResponse();
  }
  return parsed.data.markdown;
}

function errorForStatus(status: number) {
  if (status === 401 || status === 403) {
    return new AiProviderError("AI_AUTHENTICATION_ERROR", "The AI provider rejected the configured credentials.", 502, false);
  }
  if (status === 429) {
    return new AiProviderError("AI_RATE_LIMITED", "The AI provider is rate limited. Try again shortly.", 429, true);
  }
  if (status === 408 || status === 504) {
    return new AiProviderError("AI_TIMEOUT", "The AI provider took too long to respond. Try again.", 504, true);
  }
  return new AiProviderError("AI_PROVIDER_ERROR", "The AI provider could not complete this request. Try again.", 502, true);
}

export async function generateAiMarkdown(prompt: AiPrompt, options: AiProviderOptions = {}, signal?: AbortSignal) {
  const baseUrl = configuredValue(options.baseUrl ?? process.env.AI_BASE_URL) ?? "https://api.openai.com/v1";
  const apiKey = configuredValue(options.apiKey ?? process.env.AI_API_KEY);
  const model = configuredValue(options.model ?? process.env.AI_MODEL);
  if (!apiKey || !model) {
    throw new AiProviderError("AI_NOT_CONFIGURED", "AI assistance is not configured for this workspace.", 503, false);
  }

  const controller = new AbortController();
  let timedOut = false;
  let callerCancelled = signal?.aborted ?? false;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => {
    callerCancelled = true;
    controller.abort();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) {
    controller.abort();
  }

  const requestBody = {
    model,
    store: false,
    input: [
      { role: "system", content: [{ type: "input_text", text: prompt.system }] },
      { role: "user", content: [{ type: "input_text", text: prompt.user }] },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "story_workspace_markdown",
        strict: true,
        schema: responseJsonSchema,
      },
    },
    max_output_tokens: 7_000,
  };

  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    if (callerCancelled) {
      throw new AiProviderError("AI_CANCELLED", "AI generation was cancelled.", 499, false);
    }
    if (timedOut) {
      throw new AiProviderError("AI_TIMEOUT", "The AI provider took too long to respond. Try again.", 504, true);
    }
    if (!response.ok) {
      throw errorForStatus(response.status);
    }
    let payload: unknown;
    try {
      const rawPayload = await response.text();
      if (rawPayload.length > MAX_PROVIDER_PAYLOAD_BYTES) {
        throw invalidResponse();
      }
      payload = JSON.parse(rawPayload) as unknown;
    } catch {
      throw invalidResponse();
    }
    return parseResponsesMarkdown(payload);
  } catch (error) {
    if (error instanceof AiProviderError) {
      throw error;
    }
    if (callerCancelled) {
      throw new AiProviderError("AI_CANCELLED", "AI generation was cancelled.", 499, false);
    }
    if (timedOut) {
      throw new AiProviderError("AI_TIMEOUT", "The AI provider took too long to respond. Try again.", 504, true);
    }
    throw new AiProviderError("AI_PROVIDER_ERROR", "The AI provider could not be reached. Try again.", 502, true);
  } finally {
    clearTimeout(timeoutHandle);
    signal?.removeEventListener("abort", onAbort);
  }
}
