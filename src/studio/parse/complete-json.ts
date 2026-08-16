import "server-only";

import { z } from "zod";

import { StudioAiError } from "../errors";
import { resolveTextProvider, type TextProtocol } from "../settings";
import type { CompleteJson } from "./schemas";

const MAX_PROVIDER_PAYLOAD_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 300_000;
const SYSTEM_PROMPT = `Split the story into volumes, chapters, and scenes, then list entities. Return JSON only. Do not include secrets or API keys.
You must divide the whole story yourself: every scene needs volumeName and chapterName. Start a new chapter when the plot, place, or time shifts. Do not put the entire story in one chapter if it has more than two beats.
Each scene script must copy the original wording for that scene, including ALL dialogue and action lines.
Do not summarize, paraphrase, or omit spoken lines. Keep the source language.
title and intent may be short; script may not.
Clothing and wearable items are kind "costume" entities: put them in proposedEntities and attach via costumeNames.
Do not fold clothing only into a character description or outfit text.`;

const CHAT_JSON_CONTRACT = `Return JSON only with exactly these top-level keys: proposedScenes, proposedEntities.
No extra keys.

Scene fields: key, title, script, intent, characterNames, locationName, propNames, costumeNames, volumeName, chapterName
Entity fields: key, kind, name, description

Rules:
- key must match ^[a-z][a-z0-9-]{0,62}$
- kind only "character", "location", "prop", or "costume"
- Clothing and wearable items are kind "costume" entities in proposedEntities; attach them with costumeNames
- Do not fold clothing only into a character description or outfit text
- locationName is a string or null
- characterNames, propNames, and costumeNames are arrays of strings
- volumeName and chapterName are required strings; group related scenes in the same chapter
- Each scene script must copy the original wording for that scene, including ALL dialogue and action lines
- Do not summarize, paraphrase, or omit spoken lines
- Keep the source language
- title and intent may be short; script may not
- No extra keys
- Return JSON only

Example:
{"proposedScenes":[{"key":"scene-a","title":"Harbor watch","script":"Jill: \\"Any ships?\\"\\nJill: \\"None yet.\\"","intent":"Night.","characterNames":["Jill"],"locationName":"Harbor","propNames":["Lantern"],"costumeNames":["Watch coat"],"volumeName":"Volume 1","chapterName":"Harbor night"}],"proposedEntities":[{"key":"ent-jill","kind":"character","name":"Jill","description":"Lookout"},{"key":"ent-lantern","kind":"prop","name":"Lantern","description":"Oil lamp"},{"key":"ent-coat","kind":"costume","name":"Watch coat","description":"Heavy navy coat"}]}`;

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

const PROPOSAL_OBJECT_KEYS = [
  "proposedScenes",
  "proposedEntities",
  "scenes",
  "entities",
  "proposed_scenes",
  "proposed_entities",
] as const;

function looksLikeProposal(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return PROPOSAL_OBJECT_KEYS.some((key) => key in value);
}

function isInvalidModelJson(error: unknown): boolean {
  return error instanceof StudioAiError && error.code === "AI_INVALID_RESPONSE";
}

function stripThinkBlocks(text: string): string {
  return text.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "").replace(/<think\b[^>]*>[\s\S]*$/gi, "");
}

function extractCompleteJsonObjects(text: string): unknown[] {
  const parsed: unknown[] = [];
  let offset = 0;

  while (offset < text.length) {
    const start = text.indexOf("{", offset);
    if (start < 0) {
      break;
    }

    let depth = 0;
    let inString = false;
    let escape = false;
    let end: number | undefined;

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
          end = i;
          break;
        }
      }
    }

    if (end === undefined) {
      offset = start + 1;
      continue;
    }

    try {
      parsed.push(JSON.parse(text.slice(start, end + 1)) as unknown);
    } catch {
      // Skip brace-balanced slices that are not valid JSON.
    }
    offset = end + 1;
  }

  return parsed;
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

  const message = first.message;
  const content = decodeChatContent(message.content);
  const reasoningTexts: string[] = [];
  if (typeof message.reasoning_content === "string") {
    reasoningTexts.push(message.reasoning_content);
  }
  if (typeof message.reasoning === "string") {
    reasoningTexts.push(message.reasoning);
  }

  try {
    return parseModelJson(content);
  } catch (error) {
    if (!isInvalidModelJson(error)) {
      throw error;
    }
  }

  for (const reasoning of reasoningTexts) {
    try {
      return parseModelJson(reasoning);
    } catch (error) {
      if (!isInvalidModelJson(error)) {
        throw error;
      }
    }
  }

  throw invalidResponse();
}

function parseModelJson(raw: string): unknown {
  const stripped = stripThinkBlocks(raw).trim();
  const fenced = stripped.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const body = (fenced ? fenced[1] : stripped).trim();
  try {
    return JSON.parse(body) as unknown;
  } catch {
    const objects = extractCompleteJsonObjects(body);
    if (objects.length === 0) {
      throw invalidResponse();
    }
    for (let i = objects.length - 1; i >= 0; i -= 1) {
      if (looksLikeProposal(objects[i])) {
        return objects[i];
      }
    }
    return objects[objects.length - 1];
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

function responsesBody(
  model: string,
  prompt: string,
  schema: z.ZodType,
  systemPrompt: string,
  schemaName: string,
) {
  return {
    model,
    store: false,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: systemPrompt }],
      },
      { role: "user", content: [{ type: "input_text", text: prompt }] },
    ],
    text: {
      format: {
        type: "json_schema",
        name: schemaName,
        strict: true,
        schema: z.toJSONSchema(schema),
      },
    },
    max_output_tokens: 32_768,
  };
}

function chatBody(model: string, prompt: string, includeStructuredHints: boolean, systemPrompt: string) {
  const chatSystem = systemPrompt === SYSTEM_PROMPT ? CHAT_SYSTEM_PROMPT : `${systemPrompt}\n\nReturn JSON only.`;
  return {
    model,
    temperature: 0,
    max_tokens: 32_768,
    messages: [
      { role: "system", content: chatSystem },
      { role: "user", content: prompt },
    ],
    ...(includeStructuredHints
      ? {
          response_format: { type: "json_object" },
          thinking: { type: "disabled" },
        }
      : {}),
  };
}

async function requestChat(
  fetchImpl: CompleteJsonFetch,
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  signal: AbortSignal,
  systemPrompt: string,
): Promise<unknown> {
  try {
    const { payload } = await postJson(
      fetchImpl,
      endpoint(baseUrl, "chat/completions"),
      apiKey,
      chatBody(model, prompt, true, systemPrompt),
      signal,
    );
    return decodeChatJson(payload);
  } catch (error) {
    if (error instanceof StudioAiError && error.status === 400) {
      const { payload } = await postJson(
        fetchImpl,
        endpoint(baseUrl, "chat/completions"),
        apiKey,
        chatBody(model, prompt, false, systemPrompt),
        signal,
      );
      return decodeChatJson(payload);
    }
    throw error;
  }
}

export type CompleteJsonOptions = {
  systemPrompt?: string;
  schemaName?: string;
};

export async function completeJsonWithFetch(
  schema: z.ZodType,
  prompt: string,
  fetchImpl: CompleteJsonFetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  options: CompleteJsonOptions = {},
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
  }, timeoutMs);

  try {
    const systemPrompt = options.systemPrompt ?? SYSTEM_PROMPT;
    const schemaName = options.schemaName ?? "studio_parse_proposal";

    if (prefersChatCompletions(baseUrl, protocol)) {
      return await requestChat(fetchImpl, baseUrl, apiKey, model, prompt, controller.signal, systemPrompt);
    }

    try {
      const { payload } = await postJson(
        fetchImpl,
        endpoint(baseUrl, "responses"),
        apiKey,
        responsesBody(model, prompt, schema, systemPrompt, schemaName),
        controller.signal,
      );
      return decodeResponsesJson(payload);
    } catch (error) {
      if (
        protocol === "auto"
        && error instanceof StudioAiError
        && (error.status === 404 || error.status === 405)
      ) {
        return await requestChat(fetchImpl, baseUrl, apiKey, model, prompt, controller.signal, systemPrompt);
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
