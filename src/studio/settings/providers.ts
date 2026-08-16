import "server-only";

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { parseJsonRecord, writeJsonFile } from "../fs/json";

export const DEFAULT_PROVIDER_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_IMAGE_SIZE = "3840x2160";
export const DEFAULT_IMAGE_QUALITY = "high";
export const DEFAULT_USER_CONFIG_PATH = ".data/user/providers.json";

export const textProtocolSchema = z.enum(["auto", "chat", "responses"]);

export const storedTextProviderSchema = z.strictObject({
  baseUrl: z.string(),
  apiKey: z.string(),
  model: z.string(),
  protocol: textProtocolSchema.optional(),
});

export const storedImageProviderSchema = z.strictObject({
  baseUrl: z.string(),
  apiKey: z.string(),
  model: z.string(),
  size: z.string(),
  quality: z.string().optional(),
});

export const storedProviderSettingsSchema = z.strictObject({
  text: storedTextProviderSchema,
  image: storedImageProviderSchema,
});

/** Read accepts a leftover disk `video` key then drops it on write. */
const storedProviderSettingsReadSchema = z.strictObject({
  text: storedTextProviderSchema,
  image: storedImageProviderSchema,
  video: z.unknown().optional(),
});

export const putTextProviderSchema = z.strictObject({
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  protocol: textProtocolSchema.optional(),
  apiKey: z.string().optional(),
  clearApiKey: z.boolean().optional(),
});

export const putImageProviderSchema = z.strictObject({
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  size: z.string().optional(),
  quality: z.string().optional(),
  apiKey: z.string().optional(),
  clearApiKey: z.boolean().optional(),
});

export const putProviderSettingsSchema = z.strictObject({
  text: putTextProviderSchema.optional(),
  image: putImageProviderSchema.optional(),
});

export type StoredTextProvider = z.infer<typeof storedTextProviderSchema>;
export type StoredImageProvider = z.infer<typeof storedImageProviderSchema>;
export type StoredProviderSettings = z.infer<typeof storedProviderSettingsSchema>;
export type PutProviderSettings = z.infer<typeof putProviderSettingsSchema>;

export type ProviderKeySource = "user" | "env" | "default";

export type TextProtocol = z.infer<typeof textProtocolSchema>;

export type ResolvedTextProvider = {
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol: TextProtocol;
};

export type ResolvedImageProvider = {
  baseUrl: string;
  apiKey: string;
  model: string;
  size: string;
  quality: string;
};

export type PublicTextProviderView = {
  baseUrl: string;
  model: string;
  protocol: TextProtocol;
  apiKeyConfigured: boolean;
  apiKeyHint: string;
  source: ProviderKeySource;
};

export type PublicImageProviderView = {
  baseUrl: string;
  model: string;
  size: string;
  quality: string;
  apiKeyConfigured: boolean;
  apiKeyHint: string;
  source: ProviderKeySource;
};

export type PublicProviderSettings = {
  text: PublicTextProviderView;
  image: PublicImageProviderView;
};

export function emptyProviderSettings(): StoredProviderSettings {
  return {
    text: { baseUrl: "", apiKey: "", model: "", protocol: "auto" },
    image: { baseUrl: "", apiKey: "", model: "", size: "", quality: "" },
  };
}

export function getProviderSettingsPath(): string {
  const configured = process.env.STORY_USER_CONFIG?.trim();
  const raw = configured || DEFAULT_USER_CONFIG_PATH;
  return path.resolve(process.cwd(), raw);
}

export function readProviderSettings(): StoredProviderSettings {
  const filePath = getProviderSettingsPath();
  if (!fs.existsSync(filePath)) {
    return emptyProviderSettings();
  }
  const raw = parseJsonRecord(filePath, storedProviderSettingsReadSchema);
  return {
    text: raw.text,
    image: raw.image,
  };
}

export function writeProviderSettings(settings: StoredProviderSettings): void {
  const parsed = storedProviderSettingsSchema.parse(normalizeStoredSettings(settings));
  writeJsonFile(getProviderSettingsPath(), parsed);
}

export function updateProviderSettings(patch: PutProviderSettings): StoredProviderSettings {
  const current = readProviderSettings();
  const next: StoredProviderSettings = {
    text: mergeTextProvider(current.text, patch.text),
    image: mergeImageProvider(current.image, patch.image),
  };
  writeProviderSettings(next);
  return next;
}

export function resolveTextProvider(stored = readProviderSettings()): ResolvedTextProvider {
  return {
    baseUrl: firstNonEmpty(stored.text.baseUrl, envValue("AI_BASE_URL"), DEFAULT_PROVIDER_BASE_URL),
    apiKey: firstNonEmpty(stored.text.apiKey, envValue("AI_API_KEY")),
    model: firstNonEmpty(stored.text.model, envValue("AI_MODEL")),
    protocol: stored.text.protocol ?? parseEnvProtocol(envValue("AI_PROTOCOL")) ?? "auto",
  };
}

export function resolveImageProvider(stored = readProviderSettings()): ResolvedImageProvider {
  return {
    baseUrl: firstNonEmpty(
      stored.image.baseUrl,
      envValue("IMAGE_BASE_URL"),
      envValue("AI_BASE_URL"),
      DEFAULT_PROVIDER_BASE_URL,
    ),
    apiKey: firstNonEmpty(stored.image.apiKey, envValue("IMAGE_API_KEY"), envValue("AI_API_KEY")),
    model: firstNonEmpty(stored.image.model, envValue("IMAGE_MODEL")),
    size: firstNonEmpty(stored.image.size, envValue("IMAGE_SIZE"), DEFAULT_IMAGE_SIZE),
    quality: firstNonEmpty(stored.image.quality, envValue("IMAGE_QUALITY"), DEFAULT_IMAGE_QUALITY),
  };
}

export function isImageProviderConfigured(stored = readProviderSettings()): boolean {
  const image = resolveImageProvider(stored);
  return Boolean(image.apiKey && image.model);
}

export function toPublicProviderSettings(stored = readProviderSettings()): PublicProviderSettings {
  const text = resolveTextProvider(stored);
  const image = resolveImageProvider(stored);
  return {
    text: {
      baseUrl: text.baseUrl,
      model: text.model,
      protocol: text.protocol,
      apiKeyConfigured: Boolean(text.apiKey),
      apiKeyHint: apiKeyHint(text.apiKey),
      source: keySource(stored.text.apiKey, envValue("AI_API_KEY")),
    },
    image: {
      baseUrl: image.baseUrl,
      model: image.model,
      size: image.size,
      quality: image.quality,
      apiKeyConfigured: Boolean(image.apiKey),
      apiKeyHint: apiKeyHint(image.apiKey),
      source: keySource(stored.image.apiKey, envValue("IMAGE_API_KEY") ?? envValue("AI_API_KEY")),
    },
  };
}

function mergeTextProvider(current: StoredTextProvider, patch: PutProviderSettings["text"]): StoredTextProvider {
  if (!patch) {
    return current;
  }
  return {
    baseUrl: patch.baseUrl === undefined ? current.baseUrl : patch.baseUrl.trim(),
    model: patch.model === undefined ? current.model : patch.model.trim(),
    protocol: patch.protocol ?? current.protocol ?? "auto",
    apiKey: nextStoredApiKey(current.apiKey, patch.apiKey, patch.clearApiKey),
  };
}

function mergeImageProvider(current: StoredImageProvider, patch: PutProviderSettings["image"]): StoredImageProvider {
  if (!patch) {
    return current;
  }
  return {
    baseUrl: patch.baseUrl === undefined ? current.baseUrl : patch.baseUrl.trim(),
    model: patch.model === undefined ? current.model : patch.model.trim(),
    size: patch.size === undefined ? current.size : patch.size.trim(),
    quality: patch.quality === undefined ? current.quality ?? "" : patch.quality.trim(),
    apiKey: nextStoredApiKey(current.apiKey, patch.apiKey, patch.clearApiKey),
  };
}

function nextStoredApiKey(current: string, submitted: string | undefined, clearApiKey: boolean | undefined): string {
  if (clearApiKey) {
    return "";
  }
  if (submitted === undefined || submitted.trim() === "") {
    return current;
  }
  return submitted.trim();
}

function normalizeStoredSettings(settings: StoredProviderSettings): StoredProviderSettings {
  return {
    text: {
      baseUrl: settings.text.baseUrl.trim(),
      apiKey: settings.text.apiKey.trim(),
      model: settings.text.model.trim(),
      protocol: settings.text.protocol ?? "auto",
    },
    image: {
      baseUrl: settings.image.baseUrl.trim(),
      apiKey: settings.image.apiKey.trim(),
      model: settings.image.model.trim(),
      size: settings.image.size.trim(),
      quality: (settings.image.quality ?? "").trim(),
    },
  };
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

function envValue(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function parseEnvProtocol(value: string | undefined): TextProtocol | undefined {
  if (value === "auto" || value === "chat" || value === "responses") {
    return value;
  }
  return undefined;
}

function keySource(storedKey: string, envKey: string | undefined): ProviderKeySource {
  if (storedKey.trim()) {
    return "user";
  }
  if (envKey?.trim()) {
    return "env";
  }
  return "default";
}

function apiKeyHint(apiKey: string): string {
  if (!apiKey) {
    return "";
  }
  return `••••${apiKey.slice(-4)}`;
}
