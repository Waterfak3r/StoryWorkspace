import "server-only";

import { z } from "zod";

import { StudioAiError } from "../errors";
import { resolveTextProvider, type TextProtocol } from "../settings";
import type { CompleteJson } from "./schemas";

const MAX_PROVIDER_PAYLOAD_BYTES = 256 * 1024;
const SYSTEM_PROMPT = "Extract proposed scenes and entities. Return JSON only. Do not include secrets or API keys.";

const CHAT_JSON_CONTRACT = `Return JSON only with exactly these top-level keys: proposedScenes, proposedEntities.
No extra keys.

Scene fields: key, title, script, intent, characterNames, locationName
Entity fields: key, kind, name, description

Rules:
- key must match ^[a-z][a-z0-9-]{0,62}$
- kind only "character" or "location"
- locationName is a string or null
- characterNames is an array of strings
- No extra keys
- Return JSON only

Example:
{"proposedScenes":[{"key":"scene-a","title":"Harbor watch","script":"Jill waits.","intent":"Night.","characterNames":["Jill"],"locationName":"Harbor"}],"proposedEntities":[{"key":"ent-jill","kind":"character","name":"Jill","description":"Lookout"}]}`;

const CHAT_SYSTEM_PROMPT = `${SYSTEM_PROMPT}\n\n${CHAT_JSON_CONTRACT}`;

export type CompleteJsonFetch = typeof fetch;

export function prefersChatCompletions(baseUrl: string, protocol: TextProtocol): boolean {
  if (protocol === "chat") {
    return true;
  }
  if (protocol === "responses") {
    return false;
  }
  return /opencode\.ai|\/zen\/go/i.test(baseUrl);
}

function invalidResponse(message = "The AI provider returned an invalid parse result. Try again.") {
  return new StudioAiError("AI_INVALID_RESPONSE", message, 502, true);
}

function errorForStatus(status: number, detail?: string) {
  const suffix = sanitizeProviderDetail(detail);
  if (status === 401 || status === 403) {
    return new StudioAiError(
      "AI_AUTHENTICATION_ERROR",
      suffix ?? "The AI provider rejected the configured credentials.",
      status,
      false,
    );
  }
  if (status === 429) {
    return new StudioAiError("AI_RATE_LIMITED", suffix ?? "The AI provider is rate limited. Try again shortly.", status, true);
  }
  if (status === 404 || status === 405) {
    return new StudioAiError(
      "AI_PROVIDER_ERROR",
      suffix ?? "This provider does not expose the requested API protocol. Try Chat completions.",
      status,
      false,
    );
  }
  if (status === 408 || status === 504) {
    return new StudioAiError("AI_TIMEOUT", suffix ?? "The AI provider took too long to respond. Try again.", status, true);
  }
  return new StudioAiError(
    "AI_PROVIDER_ERROR",
    suffix ?? "The AI provider could not complete this request. Try again.",
    status,
    true,
  );
}

function sanitizeProviderDetail(detail: string | undefined): string | undefined {
  const trimmed = detail?.trim();
  if (!trimmed) {
    return undefined;
  }
  const cleaned = trimmed.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  return cleaned.slice(0, 240);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function providerErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const error = payload.error;
  if (typeof error === "string") {
    return error;
  }
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }
  if (typeof payload.message === "string") {
    return payload.message;
  }
  return undefined;
}

function extractFirstJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start < 0) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return undefined;
}

function decodeChatContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  const parts: string[] = [];
  for (const item of content) {
    if (typeof item === "string") {
      if (item.length > 0) {
        parts.push(item);
      }
      continue;
    }
    if (isRecord(item) && typeof item.text === "string" && item.text.length > 0) {
      parts.push(item.text);
    }
  }
  return parts.join("");
}

function decodeResponsesJson(payload: unknown): unknown {
  if (!isRecord(payload)) {
    throw invalidResponse();
  }

  if (payload.status !== undefined && payload.status !== "completed") {
    throw invalidResponse();
  }

  const textParts: string[] = [];
  const output = payload.output;
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

  return parseModelJson(textParts.join(""));
}

function decodeChatJson(payload: unknown): unknown {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    throw invalidResponse();
  }
  const first = payload.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) {
    throw invalidResponse();
  }

  let content = decodeChatContent(first.message.content);
  if (content.trim().length === 0 && typeof first.message.reasoning_content === "string") {
    const reasoning = first.message.reasoning_content;
    if (reasoning.trim().length > 0) {
      content = reasoning;
    }
  }
  if (content.trim().length === 0) {
    throw invalidResponse();
  }

  return parseModelJson(content);
}

function parseModelJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const body = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    const extracted = extractFirstJsonObject(raw);
    if (extracted === undefined) {
      throw invalidResponse();
    }
    try {
      return JSON.parse(extracted) as unknown;
    } catch {
      throw invalidResponse();
    }
  }
}

function endpoint(baseUrl: string, suffix: "responses" | "chat/completions"): string {
  return `${baseUrl.replace(/\/+$/, "")}/${suffix}`;
}

async function postJson(
  fetchImpl: CompleteJsonFetch,
  url: string,
  apiKey: string,
  body: unknown,
  signal: AbortSignal,
): Promise<{ status: number; payload: unknown }> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  const rawPayload = await response.text();
  if (rawPayload.length > MAX_PROVIDER_PAYLOAD_BYTES) {
    throw invalidResponse();
  }

  let payload: unknown = {};
  if (rawPayload.trim().length > 0) {
    try {
      payload = JSON.parse(rawPayload) as unknown;
    } catch {
      if (response.ok) {
        throw invalidResponse();
      }
    }
  }

  if (!response.ok) {
    throw errorForStatus(response.status, providerErrorMessage(payload));
  }

  return { status: response.status, payload };
}

function responsesBody(model: string, prompt: string, schema: z.ZodType) {
  return {
    model,
    store: false,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: SYSTEM_PROMPT }],
      },
      { role: "user", content: [{ type: "input_text", text: prompt }] },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "studio_parse_proposal",
        strict: true,
        schema: z.toJSONSchema(schema),
      },
    },
    max_output_tokens: 4_000,
  };
}

function chatBody(model: string, prompt: string, includeResponseFormat: boolean) {
  return {
    model,
    temperature: 0,
    messages: [
      { role: "system", content: CHAT_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    ...(includeResponseFormat ? { response_format: { type: "json_object" } } : {}),
  };
}

async function requestChat(
  fetchImpl: CompleteJsonFetch,
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    const { payload } = await postJson(
      fetchImpl,
      endpoint(baseUrl, "chat/completions"),
      apiKey,
      chatBody(model, prompt, true),
      signal,
    );
    return decodeChatJson(payload);
  } catch (error) {
    if (error instanceof StudioAiError && error.status === 400) {
      const { payload } = await postJson(
        fetchImpl,
        endpoint(baseUrl, "chat/completions"),
        apiKey,
        chatBody(model, prompt, false),
        signal,
      );
      return decodeChatJson(payload);
    }
    throw error;
  }
}

export async function completeJsonWithFetch(
  schema: z.ZodType,
  prompt: string,
  fetchImpl: CompleteJsonFetch,
): Promise<unknown> {
  const { baseUrl, apiKey, model, protocol } = resolveTextProvider();
  if (!apiKey || !model) {
    throw new StudioAiError("AI_NOT_CONFIGURED", "AI assistance is not configured for this workspace.", 503, false);
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 30_000);

  try {
    if (prefersChatCompletions(baseUrl, protocol)) {
      return await requestChat(fetchImpl, baseUrl, apiKey, model, prompt, controller.signal);
    }

    try {
      const { payload } = await postJson(
        fetchImpl,
        endpoint(baseUrl, "responses"),
        apiKey,
        responsesBody(model, prompt, schema),
        controller.signal,
      );
      return decodeResponsesJson(payload);
    } catch (error) {
      if (
        protocol === "auto"
        && error instanceof StudioAiError
        && (error.status === 404 || error.status === 405)
      ) {
        return await requestChat(fetchImpl, baseUrl, apiKey, model, prompt, controller.signal);
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof StudioAiError) {
      throw error;
    }
    if (timedOut) {
      throw new StudioAiError("AI_TIMEOUT", "The AI provider took too long to respond. Try again.", 504, true);
    }
    throw new StudioAiError("AI_PROVIDER_ERROR", "The AI provider could not be reached. Try again.", 502, true);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export const completeJson: CompleteJson = (schema, prompt) => completeJsonWithFetch(schema, prompt, fetch);
