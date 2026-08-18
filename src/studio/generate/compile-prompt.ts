import "server-only";

import { comicsPageLayoutLabel } from "../comics/page-group";
import type {
  ComposeMode,
  LetteringMode,
  PageLayout,
  StudioAttributedSpeechLine,
  StudioContextSnapshot,
} from "../domain";
import { resolveImageProvider } from "../settings";

export type CompileComicsPageOptions = {
  layout?: PageLayout;
  compose?: ComposeMode;
};

const OVERLAY_LETTERING =
  "Leave empty space in each panel for the listed speech balloons. Do not invent extra dialogue. Do not letter the words in the pixels; speech is applied as a lettering layer.";

const MODEL_LETTERING =
  "Letter ONLY the listed speech: and narration: lines, verbatim, in the matching panels. If a panel has no listed line, draw no balloon and no caption. Do not invent, complete, or paraphrase dialogue. Do not add extra narration boxes. Do not draw empty balloons.";

const NO_LETTERING =
  "Do not draw speech balloons, empty balloon outlines, captions, or any lettering on this page.";

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

  const spatial = spatialLockText([snapshot]);
  const spatialSuffix = spatial ? ` Spatial lock: ${spatial}.` : "";

  if (snapshot.continuity.prior && snapshot.continuity.from) {
    const prior = snapshot.continuity.prior;
    return [
      `Keep continuity from ${snapshot.continuity.from}`,
      `prior purpose: ${prior.purpose}`,
      `prior action: ${prior.action}`,
      `prior camera: ${prior.camera}`,
      current,
    ].join(". ") + spatialSuffix;
  }

  return `No prior shot. Maintain the current shot identity. ${current}.${spatialSuffix}`;
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
    ...priorStoryLines(snapshot),
    "Illustrate only this shot's action. Do not draw other episodes from the scene.",
    "Only draw the named characters for this shot. Do not add extra people.",
    ...formattedEntities,
    ...spatialLockLines([snapshot]),
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
  speechByShotId: Readonly<Record<string, readonly StudioAttributedSpeechLine[]>> = {},
  lettering: LetteringMode = "model",
  options: CompileComicsPageOptions = {},
): CompiledImageRequest {
  if (snapshots.length === 0) {
    return withProvider("Sequential comic page.");
  }

  const first = snapshots[0]!;
  const pageEntities = uniqueById(snapshots.flatMap((snapshot) => entitiesForShot(snapshot)));
  const hasSpeech = snapshots.some((snapshot) => (speechByShotId[snapshot.shot.id] ?? []).length > 0);
  const castNames = pageEntities
    .filter((entity) => entity.kind === "character")
    .map((entity) => entity.name)
    .filter((name) => name.trim().length > 0);
  const letteringRule = hasSpeech
    ? lettering === "overlay"
      ? OVERLAY_LETTERING
      : MODEL_LETTERING
    : NO_LETTERING;
  const panelBlocks = snapshots.map((snapshot, index) => {
    const names = entitiesForShot(snapshot)
      .filter((entity) => entity.kind === "character")
      .map((entity) => entity.name);
    const slot = panelSlotLabel(snapshots.length, index);
    const speech = speechByShotId[snapshot.shot.id] ?? [];
    return [
      `Panel ${index + 1} (${slot}): ${snapshot.shot.action}`,
      `camera: ${snapshot.shot.camera}`,
      names.length > 0 ? `on-screen: ${names.join(", ")}` : "",
      ...speech.map((line) => formatConfirmedLine(line)),
    ]
      .filter(Boolean)
      .join("\n");
  });

  const prompt = [
    first.style.visual ? `Style: ${sanitizeStyleVisual(first.style.visual, hasSpeech, lettering)}` : "",
    "ONE sequential comic PAGE as a single image.",
    "Do not generate four separate pictures. Do not collage unrelated photographs.",
    "These panels are consecutive beats of one scene and must read as one connected page.",
    pageLayoutLine(snapshots.length, options.layout, options.compose),
    "Reading order: left to right, then top to bottom. Separate panels with clear ink gutters.",
    "Keep character likeness, costume, and comic style identical across every panel on this page.",
    "If an entity lists a current state, that state overrides any identity fragment named in supersedes.",
    castNames.length > 0
      ? `Cast (draw only these people, no extras): ${castNames.join(", ")}.`
      : "Do not invent extra people.",
    letteringRule,
    ...identityLines,
    first.scene.title ? `Scene: ${first.scene.title}` : "",
    ...priorStoryLines(first),
    ...formatEntityLines(pageEntities),
    ...spatialLockLines(snapshots),
    ...panelBlocks,
    continuityConstraints ? `Continuity: ${continuityConstraints}` : "",
  ]
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  return withProvider(prompt);
}

function sanitizeStyleVisual(visual: string, hasSpeech: boolean, lettering: LetteringMode): string {
  if (hasSpeech && lettering === "overlay") {
    return visual;
  }
  return visual.replace(/;?\s*leave space for speech balloons\.?/gi, "").replace(/\s{2,}/g, " ").trim();
}

function formatConfirmedLine(line: StudioAttributedSpeechLine): string {
  if ((line.kind ?? "speech") === "narration") {
    return `narration: ${line.text}`;
  }
  return `speech: ${line.speaker}: ${line.text}`;
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

const PRIOR_STORY_SUMMARY_MAX = 160;

function priorStoryLines(snapshot: StudioContextSnapshot): string[] {
  const events = snapshot.storyPosition.events;
  if (events.length === 0) {
    return [];
  }
  return [
    "Prior story:",
    ...events.map((event) => {
      const summary = truncateText(event.summary, PRIOR_STORY_SUMMARY_MAX);
      return summary ? `${event.title}: ${summary}` : event.title;
    }),
  ];
}

function truncateText(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 1).trimEnd()}…`;
}

function formatEntityLines(entities: ReturnType<typeof entitiesForShot>): string[] {
  return entities.map((entity) => {
    const kindLabel = entity.kind === "costume" ? "costume reference" : entity.kind;
    const references = entity.visual.references.filter((ref) => ref.trim().length > 0);
    const supersedes = entity.state.supersedes ?? [];
    const description = suppressOverriddenAspects(entity.description, supersedes);
    const visualBase = suppressOverriddenAspects(entity.visual.base, supersedes);
    const identity = visualBase ? `identity lock ${entity.name}: ${visualBase}` : "";
    return [
      `${kindLabel} ${entity.name}: ${description}`.trim(),
      identity,
      visualBase ? `visual: ${visualBase}` : "",
      references.length > 0 ? `reference: ${references.join(", ")}` : "",
      entity.state.outfit ? `outfit: ${entity.state.outfit}` : "",
      entity.state.condition ? `condition: ${entity.state.condition}` : "",
      entity.state.note ? `state note: ${entity.state.note}` : "",
    ]
      .filter(Boolean)
      .join("; ");
  });
}

export function suppressOverriddenAspects(text: string, supersedes: readonly string[] | string): string {
  const source = text.trim();
  const fragments = (typeof supersedes === "string" ? [supersedes] : supersedes)
    .map((fragment) => fragment.trim())
    .filter(Boolean);
  if (!source || fragments.length === 0) {
    return text;
  }
  const foldedFragments = fragments.map((fragment) => normalizePromptText(fragment));
  const kept = source
    .split(/(?<=[,.;])\s+/)
    .map((part) => part.trim())
    .filter((part) => {
      const folded = normalizePromptText(part);
      return part.length > 0 && !foldedFragments.some((fragment) => folded.includes(fragment));
    });
  return kept.join(" ").replace(/\s{2,}/g, " ").trim();
}

function normalizePromptText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function pageLayoutLine(panelCount: number, layout?: PageLayout, compose?: ComposeMode): string {
  if (layout === "marvel" && (compose ?? "page") === "page") {
    return "Layout: irregular Marvel-style comic panels of uneven sizes, arranged organically rather than as a regular grid.";
  }
  return `Layout: ${comicsPageLayoutLabel(panelCount)}.`;
}

function spatialLockLines(snapshots: readonly StudioContextSnapshot[]): string[] {
  const spatial = spatialLockText(snapshots);
  return spatial ? [`Spatial lock: ${spatial}`] : [];
}

function spatialLockText(snapshots: readonly StudioContextSnapshot[]): string {
  const seen = new Set<string>();
  const locks: string[] = [];
  for (const snapshot of snapshots) {
    for (const entity of snapshot.entities) {
      if (entity.kind !== "location") {
        continue;
      }
      const spatial = entity.visual.spatial?.trim() ?? "";
      if (!spatial || seen.has(spatial)) {
        continue;
      }
      seen.add(spatial);
      locks.push(spatial);
    }
  }
  return locks.join("; ");
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
