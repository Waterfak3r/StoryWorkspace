import type { StudioAttributedSpeechLine } from "../domain";

export type DialogueShotRef = {
  id: string;
  action: string;
  purpose: string;
};

export type ShotDialogueAssignment = {
  shotId: string;
  lines: DialogueAssignmentLine[];
};

export type DialogueAssignmentLine = StudioAttributedSpeechLine & {
  shotId?: string | null;
};

const SOFT_FILL_PER_SHOT = 3;
const MIN_OVERLAP = 0.45;
const MIN_HITS = 2;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "for",
  "from",
  "her",
  "his",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "she",
  "that",
  "the",
  "to",
  "was",
  "you",
  "your",
]);

export function assignDialogueToShots(
  lines: readonly DialogueAssignmentLine[],
  shots: readonly DialogueShotRef[],
): ShotDialogueAssignment[] {
  if (shots.length === 0) {
    return [];
  }

  const buckets = new Map<string, DialogueAssignmentLine[]>();
  const counts = new Map<string, number>();
  for (const shot of shots) {
    buckets.set(shot.id, []);
    counts.set(shot.id, 0);
  }

  let cursor = 0;
  for (const line of lines) {
    const matched = pickShotIndex(line.text, shots, cursor, counts);
    const index = matched >= 0 ? matched : cursor;
    const shot = shots[index]!;
    buckets.get(shot.id)!.push(line);
    counts.set(shot.id, (counts.get(shot.id) ?? 0) + 1);
    cursor = matched >= 0 ? index : Math.min(index + 1, shots.length - 1);
  }

  return shots.map((shot) => ({
    shotId: shot.id,
    lines: buckets.get(shot.id) ?? [],
  }));
}

function pickShotIndex(
  text: string,
  shots: readonly DialogueShotRef[],
  cursor: number,
  counts: ReadonlyMap<string, number>,
): number {
  let bestIndex = -1;
  let bestScore = 0;
  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index]!;
    const score = overlapScore(text, `${shot.purpose} ${shot.action}`);
    const hits = overlapHits(text, `${shot.purpose} ${shot.action}`);
    if (score < MIN_OVERLAP && hits < MIN_HITS) {
      continue;
    }
    if ((counts.get(shot.id) ?? 0) >= SOFT_FILL_PER_SHOT && index < shots.length - 1) {
      continue;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    } else if (score === bestScore && bestIndex >= 0 && index >= cursor && bestIndex < cursor) {
      bestIndex = index;
    }
  }
  if (bestIndex >= 0) {
    return bestIndex;
  }
  return uniqueLongTokenShot(text, shots, cursor);
}

function uniqueLongTokenShot(
  text: string,
  shots: readonly DialogueShotRef[],
  cursor: number,
): number {
  for (const token of tokens(text).filter((item) => item.length >= 6)) {
    const holders = shots
      .map((shot, index) => ({ index, shot }))
      .filter((item) => tokens(`${item.shot.purpose} ${item.shot.action}`).includes(token));
    if (holders.length === 1 && holders[0]!.index >= cursor) {
      return holders[0]!.index;
    }
  }
  return -1;
}

export function scoreLineAgainstShot(text: string, shot: DialogueShotRef): number {
  return overlapScore(text, `${shot.purpose} ${shot.action}`);
}

function overlapHits(line: string, shotText: string): number {
  const lineTokens = tokens(line);
  const shotTokens = new Set(tokens(shotText));
  return lineTokens.filter((token) => shotTokens.has(token)).length;
}

function overlapScore(line: string, shotText: string): number {
  const lineTokens = tokens(line);
  if (lineTokens.length === 0) {
    return 0;
  }
  return overlapHits(line, shotText) / lineTokens.length;
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

export function lineBeat(text: string): string | null {
  return tokens(text)[0] ?? null;
}

export function shotBeat(shot: DialogueShotRef): string | null {
  return tokens(`${shot.purpose} ${shot.action}`)[0] ?? null;
}
