import "server-only";

import type { StudioContextSnapshot } from "../domain";
import { resolveImageProvider } from "../settings";

const DEFAULT_IMAGE_MODEL = "gpt-image-2";

export type CompiledImageRequest = {
  prompt: string;
  provider: {
    model: string;
    size: string;
    quality: string;
  };
};

export function buildContinuityConstraints(snapshot: StudioContextSnapshot): string {
  const current = [
    `current shot ${snapshot.shot.id}`,
    `purpose: ${snapshot.shot.purpose}`,
    `action: ${snapshot.shot.action}`,
    `camera: ${snapshot.shot.camera}`,
  ].join("; ");

  if (snapshot.continuity.prior && snapshot.continuity.from) {
    const prior = snapshot.continuity.prior;
    return [
      `Keep continuity from ${snapshot.continuity.from}`,
      `prior purpose: ${prior.purpose}`,
      `prior action: ${prior.action}`,
      `prior camera: ${prior.camera}`,
      current,
    ].join(". ");
  }

  return `No prior shot. Maintain the current shot identity. ${current}.`;
}

export function compileImagePrompt(
  snapshot: StudioContextSnapshot,
  continuityConstraints = "",
): CompiledImageRequest {
  const entityLines = snapshot.entities.map((entity) => {
    const kindLabel = entity.kind === "costume" ? "costume reference" : entity.kind;
    const references = entity.visual.references.filter((ref) => ref.trim().length > 0);
    return [
      `${kindLabel} ${entity.name}: ${entity.description}`.trim(),
      entity.visual.base ? `visual: ${entity.visual.base}` : "",
      references.length > 0 ? `reference: ${references.join(", ")}` : "",
      entity.state.outfit ? `outfit: ${entity.state.outfit}` : "",
      entity.state.condition ? `condition: ${entity.state.condition}` : "",
    ]
      .filter(Boolean)
      .join("; ");
  });

  const prompt = [
    snapshot.style.visual ? `Style: ${snapshot.style.visual}` : "",
    snapshot.intent ? `Intent: ${snapshot.intent}` : "",
    snapshot.scene.title || snapshot.scene.script
      ? `Scene: ${snapshot.scene.title}. ${snapshot.scene.script}`.trim()
      : "",
    ...entityLines,
    `Shot purpose: ${snapshot.shot.purpose}`,
    `Action: ${snapshot.shot.action}`,
    `Camera: ${snapshot.shot.camera}`,
    continuityConstraints ? `Continuity: ${continuityConstraints}` : "",
  ]
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  const image = resolveImageProvider();
  return {
    prompt: prompt || `Storyboard still for shot ${snapshot.shot.id}.`,
    provider: {
      model: image.model || DEFAULT_IMAGE_MODEL,
      size: image.size,
      quality: image.quality,
    },
  };
}
