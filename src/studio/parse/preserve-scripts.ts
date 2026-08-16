import { isStudioSlug, slugifyTitle } from "../domain";
import type { LlmParseProposal, ProposedScene } from "./schemas";

const DIALOGUE_MARKS = new Set([
  '"',
  "'",
  "\u201c",
  "\u201d",
  "\u2018",
  "\u2019",
  "「",
  "」",
  "『",
  "』",
]);

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function hasDialogueMark(text: string): boolean {
  for (const ch of text) {
    if (DIALOGUE_MARKS.has(ch)) {
      return true;
    }
  }
  return false;
}

export function scriptsCoverSource(source: string, scripts: string[]): boolean {
  const normalizedSource = normalizeWhitespace(source);
  if (normalizedSource.length === 0) {
    return true;
  }

  const combined = normalizeWhitespace(scripts.join(" "));
  if (combined.length < normalizedSource.length * 0.6) {
    return false;
  }

  if (hasDialogueMark(normalizedSource) && !hasDialogueMark(combined)) {
    return false;
  }

  return true;
}

function uniqueNames(scenes: ProposedScene[], field: "characterNames" | "propNames" | "costumeNames"): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const scene of scenes) {
    for (const name of scene[field]) {
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

function firstLocationName(scenes: ProposedScene[]): string | null {
  for (const scene of scenes) {
    if (scene.locationName !== null) {
      return scene.locationName;
    }
  }
  return null;
}

function collapseToSourceScene(sourceText: string, scenes: ProposedScene[]): ProposedScene {
  const first = scenes[0];
  if (!first) {
    return {
      key: "scene",
      title: "Imported",
      script: sourceText,
      intent: "",
      characterNames: [],
      locationName: null,
      propNames: [],
      costumeNames: [],
    };
  }

  const key =
    isStudioSlug(first.key) ? first.key : slugifyTitle(first.title || "scene");

  return {
    key,
    title: first.title.trim().length > 0 ? first.title : "Imported",
    script: sourceText,
    intent: first.intent,
    characterNames: uniqueNames(scenes, "characterNames"),
    locationName: firstLocationName(scenes),
    propNames: uniqueNames(scenes, "propNames"),
    costumeNames: uniqueNames(scenes, "costumeNames"),
  };
}

export function preserveProposalScripts(
  sourceText: string,
  proposal: LlmParseProposal,
): LlmParseProposal {
  const scripts = proposal.proposedScenes.map((scene) => scene.script);
  if (scriptsCoverSource(sourceText, scripts)) {
    return proposal;
  }

  return {
    proposedEntities: proposal.proposedEntities,
    proposedScenes: [collapseToSourceScene(sourceText, proposal.proposedScenes)],
  };
}
