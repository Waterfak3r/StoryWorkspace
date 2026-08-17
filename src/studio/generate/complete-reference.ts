import "server-only";

import fs from "node:fs";

import type { StudioEntity, StudioStyle } from "../domain";
import { StudioValidationError } from "../errors";
import { readEntity, readStyle } from "../fs";
import { isImageProviderConfigured, resolveImageProvider } from "../settings";
import type { ImageAdapter } from "./adapter";
import { withImageAdapterRetry } from "./adapter";
import { addEntityReferenceImage, MAX_ENTITY_REFERENCE_IMAGES } from "./entity-references";
import { fakeImageAdapter } from "./fake-image-adapter";
import { openaiCompatibleImageAdapter } from "./openai-image-adapter";
import { allocateRunId, projectFileExists, resolveProjectRelativeFile } from "./workflow-store";

const DEFAULT_IMAGE_MODEL = "gpt-image-2";

const defaultImageAdapter: ImageAdapter = withImageAdapterRetry(async (input) => {
  const adapter = isImageProviderConfigured() ? openaiCompatibleImageAdapter : fakeImageAdapter;
  return adapter(input);
});

export function compileEntityReferencePrompt(entity: StudioEntity, style: Pick<StudioStyle, "visual">): string {
  const kindLine =
    entity.kind === "character"
      ? "Front-facing character reference portrait on a plain background. Show the full costume and face clearly."
      : entity.kind === "location"
        ? "Establishing location reference, empty of named characters."
        : entity.kind === "costume"
          ? "Costume reference on a stand, isolated, no extra people."
          : "Isolated prop reference on a plain background.";

  return [
    style.visual ? `Style: ${style.visual}` : "",
    "ONE reference image, not a comic page and not a panel grid.",
    "No speech balloons. No lettering.",
    kindLine,
    `Subject: ${entity.name}`,
    entity.description.trim() ? `Description: ${entity.description.trim()}` : "",
    entity.visual.base.trim() ? `Visual base: ${entity.visual.base.trim()}` : "",
    entity.states.default.outfit.trim() ? `Outfit: ${entity.states.default.outfit.trim()}` : "",
  ]
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

export async function completeEntityReference(
  projectId: string,
  entityId: string,
  adapter: ImageAdapter = defaultImageAdapter,
): Promise<{ entity: StudioEntity; relativePath: string; compiled: string }> {
  const entity = readEntity(projectId, entityId);
  if (entity.visual.references.length >= MAX_ENTITY_REFERENCE_IMAGES) {
    throw new StudioValidationError("This entity already has the maximum number of reference images.");
  }

  const style = readStyle(projectId);
  const compiled = compileEntityReferencePrompt(entity, style);
  const image = resolveImageProvider();
  const runId = allocateRunId(projectId);
  const output = await adapter({
    projectId,
    sceneId: "scene-01",
    shotId: entity.id,
    runId,
    prompt: compiled,
    provider: {
      model: image.model || DEFAULT_IMAGE_MODEL,
      size: image.size,
      quality: image.quality,
    },
  });

  const written = resolveProjectRelativeFile(projectId, output.relativePath);
  if (!projectFileExists(written)) {
    throw new StudioValidationError("Image adapter did not write an image file.");
  }

  const bytes = fs.readFileSync(written);
  const saved = addEntityReferenceImage(projectId, entity.id, bytes, "auto.png");
  return { entity: saved.entity, relativePath: saved.relativePath, compiled };
}
