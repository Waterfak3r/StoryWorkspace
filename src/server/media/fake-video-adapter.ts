import "server-only";

import { createHash } from "node:crypto";
import {
  compiledGenerationRequestSchema,
  fakePreparedRequestSchema,
  type CompiledGenerationRequest,
  type FakePreparedRequest,
} from "@/domain/generation-compiler";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
  }
  return value;
}
function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export type FakeVideoValidationResult =
  | { valid: true }
  | { valid: false; issues: string[] };

/**
 * A provider boundary for local previews. It intentionally has no submit,
 * network, or secret-bearing behavior; Phase 5C will add those separately.
 */
export class FakeVideoAdapter {
  validate(request: unknown): FakeVideoValidationResult {
    const parsed = compiledGenerationRequestSchema.safeParse(request);
    if (!parsed.success) return { valid: false, issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
    if (parsed.data.promptSegments.map((segment) => segment.text).join("\n").length > 4_000) {
      return { valid: false, issues: ["prompt exceeds the fake-video 4000 character limit"] };
    }
    return { valid: true };
  }

  prepare(request: CompiledGenerationRequest): FakePreparedRequest {
    const parsed = compiledGenerationRequestSchema.parse(request);
    const body = {
      prompt: parsed.promptSegments.map((segment) => segment.text).join("\n"),
      negativePrompt: parsed.negativePrompt,
      referenceAssetIds: parsed.assetInputs.map((asset) => asset.assetId),
      durationSeconds: parsed.parameters.durationSeconds,
      aspectRatio: parsed.parameters.aspectRatio,
    };
    return fakePreparedRequestSchema.parse({
      provider: parsed.provider,
      model: parsed.model,
      endpoint: "fake://video/generate",
      body,
      requestHash: sha256(canonicalJson({ provider: parsed.provider, model: parsed.model, endpoint: "fake://video/generate", body })),
    });
  }
}

export const fakeVideoAdapter = new FakeVideoAdapter();
export function createFakeVideoAdapter() {
  return new FakeVideoAdapter();
}
