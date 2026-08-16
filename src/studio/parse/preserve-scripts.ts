import { isStudioSlug, slugifyTitle } from "../domain";
import type { LlmParseProposal, ProposedEntity, ProposedScene } from "./schemas";

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

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "him",
  "his",
  "in",
  "into",
  "is",
  "it",
  "its",
  "not",
  "of",
  "on",
  "or",
  "she",
  "that",
  "the",
  "their",
  "them",
  "then",
  "they",
  "this",
  "to",
  "was",
  "were",
  "with",
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

function foldForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function nameAppearsInText(text: string, name: string): boolean {
  const needle = foldForMatch(name);
  if (needle.length < 2) {
    return false;
  }

  const hay = ` ${foldForMatch(text)} `;
  if (hay.includes(` ${needle} `) || hay.includes(` ${needle}'s `) || hay.includes(` ${needle}' `)) {
    return true;
  }

  const tokens = needle.split(" ").filter((token) => token.length >= 3 && !STOPWORDS.has(token));
  return tokens.some((token) => hay.includes(` ${token} `) || hay.includes(` ${token}'s `));
}

function uniqueNames(values: string[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    names.push(trimmed);
  }
  return names;
}

function uniqueNamesFromScenes(scenes: ProposedScene[], field: "characterNames" | "propNames" | "costumeNames"): string[] {
  return uniqueNames(scenes.flatMap((scene) => scene[field]));
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
      volumeName: "Volume 1",
      chapterName: "Chapter 1",
    };
  }

  const key = isStudioSlug(first.key) ? first.key : slugifyTitle(first.title || "scene");

  return {
    key,
    title: first.title.trim().length > 0 ? first.title : "Imported",
    script: sourceText,
    intent: first.intent,
    characterNames: uniqueNamesFromScenes(scenes, "characterNames"),
    locationName: firstLocationName(scenes),
    propNames: uniqueNamesFromScenes(scenes, "propNames"),
    costumeNames: uniqueNamesFromScenes(scenes, "costumeNames"),
    volumeName: first.volumeName.trim() || "Volume 1",
    chapterName: first.chapterName.trim() || first.title || "Chapter 1",
  };
}

function catalogNames(proposal: LlmParseProposal, kind: ProposedEntity["kind"]): string[] {
  const fromEntities = proposal.proposedEntities.filter((entity) => entity.kind === kind).map((entity) => entity.name);
  if (kind === "character") {
    return uniqueNames([...fromEntities, ...uniqueNamesFromScenes(proposal.proposedScenes, "characterNames")]);
  }
  if (kind === "prop") {
    return uniqueNames([...fromEntities, ...uniqueNamesFromScenes(proposal.proposedScenes, "propNames")]);
  }
  if (kind === "costume") {
    return uniqueNames([...fromEntities, ...uniqueNamesFromScenes(proposal.proposedScenes, "costumeNames")]);
  }
  const fromScenes = proposal.proposedScenes
    .map((scene) => scene.locationName)
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0);
  return uniqueNames([...fromEntities, ...fromScenes]);
}

function namesPresentIn(names: string[], text: string): string[] {
  return names.filter((name) => nameAppearsInText(text, name));
}

function rebindNameList(original: string[], catalog: string[], chunk: string, fullSource: string): string[] {
  const appearing = namesPresentIn(catalog, chunk);
  const unmatchedOriginals = original.filter((name) => !nameAppearsInText(fullSource, name));
  const rebound = uniqueNames([...appearing, ...unmatchedOriginals]);
  return rebound.length > 0 ? rebound : uniqueNames(original);
}

function rebindLocation(original: string | null, catalog: string[], chunk: string, fullSource: string): string | null {
  const appearing = namesPresentIn(catalog, chunk);
  if (appearing.length > 0) {
    return appearing.sort((left, right) => right.length - left.length)[0] ?? original;
  }
  if (original && !nameAppearsInText(fullSource, original)) {
    return original;
  }
  return original;
}

function distinctiveTokens(text: string): string[] {
  return foldForMatch(text)
    .split(" ")
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function scoreBlockAgainstScene(block: string, scene: ProposedScene): number {
  let score = 0;
  for (const name of scene.characterNames) {
    if (nameAppearsInText(block, name)) {
      score += 6;
    }
  }
  if (scene.locationName && nameAppearsInText(block, scene.locationName)) {
    score += 3;
  }
  for (const name of scene.propNames) {
    if (nameAppearsInText(block, name)) {
      score += 2;
    }
  }
  for (const name of scene.costumeNames) {
    if (nameAppearsInText(block, name)) {
      score += 2;
    }
  }
  for (const token of distinctiveTokens(scene.title)) {
    if (nameAppearsInText(block, token)) {
      score += 4;
    }
  }
  for (const token of distinctiveTokens(scene.script)) {
    if (nameAppearsInText(block, token)) {
      score += 2;
    }
  }
  return score;
}

function rebindSceneToChunk(
  scene: ProposedScene,
  chunk: string,
  proposal: LlmParseProposal,
  fullSource: string,
): ProposedScene {
  return {
    ...scene,
    script: chunk,
    characterNames: rebindNameList(
      scene.characterNames,
      catalogNames(proposal, "character"),
      chunk,
      fullSource,
    ),
    locationName: rebindLocation(scene.locationName, catalogNames(proposal, "location"), chunk, fullSource),
    propNames: rebindNameList(scene.propNames, catalogNames(proposal, "prop"), chunk, fullSource),
    costumeNames: rebindNameList(scene.costumeNames, catalogNames(proposal, "costume"), chunk, fullSource),
  };
}

type SourceBlocks = {
  blocks: string[];
  joiner: string;
};

function sourceBlocks(source: string, minCount: number): SourceBlocks | null {
  const trimmed = source.trim();
  if (!trimmed) {
    return null;
  }

  const paragraphs = trimmed.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  if (paragraphs.length >= minCount) {
    return { blocks: paragraphs, joiner: "\n\n" };
  }

  const lines = trimmed.split(/\n/).map((part) => part.trim()).filter(Boolean);
  if (lines.length >= minCount) {
    return { blocks: lines, joiner: "\n" };
  }

  const sentences = trimmed.split(/(?<=[.!?。！？])\s+/).map((part) => part.trim()).filter(Boolean);
  if (sentences.length >= minCount) {
    return { blocks: sentences, joiner: " " };
  }

  return null;
}

function alignScenesToSource(
  source: string,
  proposal: LlmParseProposal,
): ProposedScene[] | null {
  const scenes = proposal.proposedScenes;
  const parts = sourceBlocks(source, scenes.length);
  if (!parts) {
    return null;
  }

  const { blocks, joiner } = parts;
  const sceneCount = scenes.length;
  const blockCount = blocks.length;
  const scores = scenes.map((scene, sceneIndex) => blocks.map((block, index) => {
    const positional = 1 - Math.abs(
      index / Math.max(1, blockCount - 1) - sceneIndex / Math.max(1, sceneCount - 1),
    );
    return scoreBlockAgainstScene(block, scene) + positional * 0.05;
  }));

  const rangeScore = (sceneIndex: number, start: number, end: number): number => {
    let total = 0;
    for (let index = start; index < end; index += 1) {
      total += scores[sceneIndex]![index]!;
    }
    return total;
  };

  const negative = Number.NEGATIVE_INFINITY;
  const best: number[][] = Array.from({ length: blockCount + 1 }, () => Array.from({ length: sceneCount + 1 }, () => negative));
  const prev: number[][] = Array.from({ length: blockCount + 1 }, () => Array.from({ length: sceneCount + 1 }, () => -1));
  best[0]![0] = 0;

  for (let sceneIndex = 1; sceneIndex <= sceneCount; sceneIndex += 1) {
    for (let end = sceneIndex; end <= blockCount; end += 1) {
      for (let start = sceneIndex - 1; start < end; start += 1) {
        const previous = best[start]![sceneIndex - 1]!;
        if (!Number.isFinite(previous)) {
          continue;
        }
        const candidate = previous + rangeScore(sceneIndex - 1, start, end);
        if (candidate > best[end]![sceneIndex]!) {
          best[end]![sceneIndex] = candidate;
          prev[end]![sceneIndex] = start;
        }
      }
    }
  }

  if (!Number.isFinite(best[blockCount]![sceneCount]!)) {
    return null;
  }

  const cuts: number[] = Array.from({ length: sceneCount + 1 }, () => 0);
  cuts[sceneCount] = blockCount;
  for (let sceneIndex = sceneCount; sceneIndex >= 1; sceneIndex -= 1) {
    const start = prev[cuts[sceneIndex]!]![sceneIndex]!;
    if (start < 0) {
      return null;
    }
    cuts[sceneIndex - 1] = start;
  }

  return scenes.map((scene, sceneIndex) => {
    const chunk = blocks.slice(cuts[sceneIndex], cuts[sceneIndex + 1]).join(joiner);
    return rebindSceneToChunk(scene, chunk, proposal, source);
  });
}

function splitSourceIntoChunks(source: string, count: number): string[] | null {
  const parts = sourceBlocks(source, count);
  if (!parts) {
    return null;
  }
  return partitionBlocks(parts.blocks, count, parts.joiner);
}

function partitionBlocks(blocks: string[], count: number, joiner: string): string[] {
  const base = Math.floor(blocks.length / count);
  const extra = blocks.length % count;
  const chunks: string[] = [];
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    const size = base + (index < extra ? 1 : 0);
    chunks.push(blocks.slice(offset, offset + size).join(joiner));
    offset += size;
  }
  return chunks;
}

export function preserveProposalScripts(
  sourceText: string,
  proposal: LlmParseProposal,
): LlmParseProposal {
  const scripts = proposal.proposedScenes.map((scene) => scene.script);
  if (scriptsCoverSource(sourceText, scripts)) {
    return proposal;
  }

  const scenes = proposal.proposedScenes;
  if (scenes.length >= 2) {
    const aligned = alignScenesToSource(sourceText, proposal);
    if (aligned && scriptsCoverSource(sourceText, aligned.map((scene) => scene.script))) {
      return {
        proposedEntities: proposal.proposedEntities,
        proposedScenes: aligned,
      };
    }

    const chunks = splitSourceIntoChunks(sourceText, scenes.length);
    if (chunks && scriptsCoverSource(sourceText, chunks)) {
      return {
        proposedEntities: proposal.proposedEntities,
        proposedScenes: scenes.map((scene, index) =>
          rebindSceneToChunk(scene, chunks[index] ?? scene.script, proposal, sourceText),
        ),
      };
    }
  }

  return {
    proposedEntities: proposal.proposedEntities,
    proposedScenes: [collapseToSourceScene(sourceText, scenes)],
  };
}
