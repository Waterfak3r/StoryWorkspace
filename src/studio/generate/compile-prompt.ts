import "server-only";

import { comicsPageLayoutLabel } from "../comics/page-group";
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
  const focusedEntities = entitiesForShot(snapshot);
  const focusedCharacterNames = new Set(
    focusedEntities.filter((entity) => entity.kind === "character").map((entity) => entity.name.trim().toLowerCase()),
  );
  const formattedEntities = formatEntityLines(focusedEntities);

  const prompt = [
    snapshot.style.visual ? `Style: ${snapshot.style.visual}` : "",
    "Draw sequential comic art as one image, not a photoreal still and not a collage of separate pictures.",
    "Keep character likeness, costume, and comic style identical across shots of this story.",
    intentLine(snapshot, focusedCharacterNames),
    snapshot.scene.title ? `Scene: ${snapshot.scene.title}` : "",
    "Illustrate only this shot's action. Do not draw other episodes from the scene.",
    "Only draw the named characters for this shot. Do not add extra people.",
    ...formattedEntities,
    `Shot purpose: ${snapshot.shot.purpose}`,
    `Action: ${snapshot.shot.action}`,
    `Camera: ${snapshot.shot.camera}`,
    continuityConstraints ? `Continuity: ${continuityConstraints}` : "",
  ]
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  return withProvider(prompt || `Comic page for shot ${snapshot.shot.id}.`);
}

export function compileComicsPagePrompt(
  snapshots: readonly StudioContextSnapshot[],
  continuityConstraints = "",
  identityLines: readonly string[] = [],
): CompiledImageRequest {
  if (snapshots.length === 0) {
    return withProvider("Sequential comic page.");
  }

  const first = snapshots[0]!;
  const pageEntities = uniqueById(snapshots.flatMap((snapshot) => entitiesForShot(snapshot)));
  const panelBlocks = snapshots.map((snapshot, index) => {
    const names = entitiesForShot(snapshot)
      .filter((entity) => entity.kind === "character")
      .map((entity) => entity.name);
    const slot = panelSlotLabel(snapshots.length, index);
    return [
      `Panel ${index + 1} (${slot}): ${snapshot.shot.action}`,
      `camera: ${snapshot.shot.camera}`,
      names.length > 0 ? `on-screen: ${names.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });

  const prompt = [
    first.style.visual ? `Style: ${first.style.visual}` : "",
    "ONE sequential comic PAGE as a single image.",
    "Do not generate four separate pictures. Do not collage unrelated photographs.",
    "These panels are consecutive beats of one scene and must read as one connected page.",
    `Layout: ${comicsPageLayoutLabel(snapshots.length)}.`,
    "Reading order: left to right, then top to bottom. Separate panels with clear ink gutters.",
    "Keep character likeness, costume, and comic style identical across every panel on this page.",
    ...identityLines,
    first.scene.title ? `Scene: ${first.scene.title}` : "",
    ...formatEntityLines(pageEntities),
    ...panelBlocks,
    continuityConstraints ? `Continuity: ${continuityConstraints}` : "",
  ]
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  return withProvider(prompt);
}

function withProvider(prompt: string): CompiledImageRequest {
  const image = resolveImageProvider();
  return {
    prompt,
    provider: {
      model: image.model || DEFAULT_IMAGE_MODEL,
      size: image.size,
      quality: image.quality,
    },
  };
}

function formatEntityLines(entities: ReturnType<typeof entitiesForShot>): string[] {
  return entities.map((entity) => {
    const kindLabel = entity.kind === "costume" ? "costume reference" : entity.kind;
    const references = entity.visual.references.filter((ref) => ref.trim().length > 0);
    const identity = entity.visual.base ? `identity lock ${entity.name}: ${entity.visual.base}` : "";
    return [
      `${kindLabel} ${entity.name}: ${entity.description}`.trim(),
      identity,
      entity.visual.base ? `visual: ${entity.visual.base}` : "",
      references.length > 0 ? `reference: ${references.join(", ")}` : "",
      entity.state.outfit ? `outfit: ${entity.state.outfit}` : "",
      entity.state.condition ? `condition: ${entity.state.condition}` : "",
    ]
      .filter(Boolean)
      .join("; ");
  });
}

function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}

function panelSlotLabel(count: number, index: number): string {
  if (count <= 1) {
    return "full page";
  }
  if (count === 2) {
    return index === 0 ? "top" : "bottom";
  }
  if (count === 3) {
    return index === 0 ? "top-left" : index === 1 ? "top-right" : "bottom wide";
  }
  return index === 0 ? "top-left" : index === 1 ? "top-right" : index === 2 ? "bottom-left" : "bottom-right";
}

function intentLine(
  snapshot: StudioContextSnapshot,
  focusedCharacterNames: Set<string>,
): string {
  const intent = snapshot.intent.trim();
  if (!intent) {
    return "";
  }
  const extras = snapshot.entities.filter(
    (entity) =>
      entity.kind === "character" &&
      !focusedCharacterNames.has(entity.name.trim().toLowerCase()) &&
      mentionsCharacterOnScreen(intent, entity.name),
  );
  if (extras.length > 0) {
    return "";
  }
  return `Intent: ${intent}`;
}

export function entitiesForShot(snapshot: StudioContextSnapshot) {
  const currentText = `${snapshot.shot.purpose} ${snapshot.shot.action}`;
  const priorText = snapshot.continuity.prior
    ? `${snapshot.continuity.prior.purpose} ${snapshot.continuity.prior.action}`
    : "";
  const insertShot = /\binsert\b/i.test(snapshot.shot.camera);
  const carryPrior = !insertShot && priorText.length > 0;

  const mentioned = snapshot.entities.filter((entity) => {
    if (entity.kind === "location") {
      return true;
    }
    if (entity.kind !== "character") {
      return mentionsCharacterOnScreen(currentText, entity.name);
    }
    if (mentionsCharacterOnScreen(currentText, entity.name)) {
      return true;
    }
    return carryPrior && mentionsCharacterOnScreen(priorText, entity.name);
  });

  const hasCharacter = mentioned.some((entity) => entity.kind === "character");
  if (hasCharacter || insertShot) {
    return mentioned;
  }

  return snapshot.entities.filter((entity) => entity.kind !== "character");
}

export function mentionsCharacterOnScreen(text: string, name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    return false;
  }
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^A-Za-z])${escaped}(?!['’]s)(?=[^A-Za-z]|$)`, "i");
  return pattern.test(text);
}
