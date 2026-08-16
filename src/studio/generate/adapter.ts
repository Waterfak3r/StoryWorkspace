import "server-only";

import { StudioAiError } from "../errors";

export type ImageAdapterInput = {
  projectId: string;
  sceneId: string;
  shotId: string;
  runId: string;
  prompt: string;
  pageId?: string;
  referenceImages?: readonly ImageReferenceInput[];
  provider: {
    model: string;
    size: string;
    quality: string;
  };
};

export type ImageReferenceInput = {
  filename: string;
  mime: string;
  bytes: Buffer;
};

export type ImageAdapterResult = {
  relativePath: string;
};

export type ImageAdapter = (input: ImageAdapterInput) => Promise<ImageAdapterResult> | ImageAdapterResult;

const DEFAULT_ATTEMPTS = 2;

export function withImageAdapterRetry(adapter: ImageAdapter, attempts = DEFAULT_ATTEMPTS): ImageAdapter {
  return async (input) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const result = await adapter(input);
        if (!result.relativePath.trim()) {
          throw new Error("Image adapter returned an empty path.");
        }
        return result;
      } catch (error) {
        lastError = error;
        if (error instanceof StudioAiError && error.retryable === false) {
          break;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Image adapter failed.");
  };
}
