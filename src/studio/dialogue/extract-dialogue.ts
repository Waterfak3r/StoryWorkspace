import type { StudioAttributedSpeechLine } from "../domain";

export type DialogueCharacterRef = {
  id: string;
  name: string;
};

const ATTRIBUTION_VERBS =
  "said|says|asked|asks|whispered|whispers|cried|cries|shouted|shouts|replied|replies|answered|answers|muttered|mutters|yelled|yells|called|calls";

export function extractAttributedDialogue(
  script: string,
  characters: readonly DialogueCharacterRef[],
): StudioAttributedSpeechLine[] {
  const text = script.replace(/\r\n/g, "\n");
  if (!text.trim()) {
    return [];
  }

  const found: { start: number; end: number; speaker: string; body: string }[] = [];
  collectColonLines(text, found);
  collectSaidBeforeQuote(text, characters, found);
  collectQuoteThenSaid(text, characters, found);
  collectChineseSaid(text, characters, found);

  found.sort((left, right) => left.start - right.start || right.end - left.end);
  const kept: typeof found = [];
  for (const hit of found) {
    if (kept.some((prior) => overlaps(prior, hit))) {
      continue;
    }
    const body = normalizeSpeechText(hit.body);
    const speaker = hit.speaker.trim();
    if (!body || !speaker) {
      continue;
    }
    kept.push({ ...hit, speaker, body });
  }

  return kept.map((hit, index) => ({
    id: `line-${String(index + 1).padStart(2, "0")}`,
    speaker: hit.speaker,
    speakerId: resolveSpeakerId(hit.speaker, characters),
    text: hit.body,
  }));
}

function collectColonLines(
  script: string,
  found: { start: number; end: number; speaker: string; body: string }[],
) {
  const pattern = /^[ \t]*([^\n:：]{1,40}?)[ \t]*[:：][ \t]*([「『“"']?)(.+?)\2?[ \t]*$/gm;
  for (const match of script.matchAll(pattern)) {
    const speaker = (match[1] ?? "").trim();
    const body = (match[3] ?? "").trim();
    if (!speaker || !body || isNarrationSpeaker(speaker)) {
      continue;
    }
    const start = match.index ?? 0;
    found.push({ start, end: start + match[0].length, speaker, body });
  }
}

function collectSaidBeforeQuote(
  script: string,
  characters: readonly DialogueCharacterRef[],
  found: { start: number; end: number; speaker: string; body: string }[],
) {
  const names = nameAlternation(characters);
  const pattern = new RegExp(
    `\\b(${names})\\b\\s+(?:${ATTRIBUTION_VERBS})[,，]?\\s*[「『“"]([^」』”"]{1,240})[」』”"]`,
    "gi",
  );
  pushMatches(script, pattern, 1, 2, found);
}

function collectQuoteThenSaid(
  script: string,
  characters: readonly DialogueCharacterRef[],
  found: { start: number; end: number; speaker: string; body: string }[],
) {
  const names = nameAlternation(characters);
  const pattern = new RegExp(
    `[「『“"]([^」』”"]{1,240})[」』”"][,，]?\\s+(?:${ATTRIBUTION_VERBS})\\s+(${names})\\b`,
    "gi",
  );
  pushMatches(script, pattern, 2, 1, found);
}

function collectChineseSaid(
  script: string,
  characters: readonly DialogueCharacterRef[],
  found: { start: number; end: number; speaker: string; body: string }[],
) {
  if (characters.length === 0) {
    return;
  }
  const names = nameAlternation(characters);
  const before = new RegExp(
    `(${names})\\s*(?:说|问|喊|道|答)[,，]?\\s*[「『“"]([^」』”"]{1,240})[」』”"]`,
    "g",
  );
  const after = new RegExp(
    `[「『“"]([^」』”"]{1,240})[」』”"]\\s*(${names})\\s*(?:说|问|喊|道|答)`,
    "g",
  );
  pushMatches(script, before, 1, 2, found);
  pushMatches(script, after, 2, 1, found);
}

function pushMatches(
  script: string,
  pattern: RegExp,
  speakerIndex: number,
  bodyIndex: number,
  found: { start: number; end: number; speaker: string; body: string }[],
) {
  for (const match of script.matchAll(pattern)) {
    const speaker = (match[speakerIndex] ?? "").trim();
    const body = (match[bodyIndex] ?? "").trim();
    if (!speaker || !body) {
      continue;
    }
    const start = match.index ?? 0;
    found.push({ start, end: start + match[0].length, speaker, body });
  }
}

function nameAlternation(characters: readonly DialogueCharacterRef[]): string {
  const names = characters
    .map((character) => character.name.trim())
    .filter((name) => name.length > 0)
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp);
  return names.length > 0 ? names.join("|") : "[A-Z][\\w.\\-]*";
}

function resolveSpeakerId(speaker: string, characters: readonly DialogueCharacterRef[]): string | null {
  const needle = speaker.trim().toLowerCase();
  const exact = characters.find((character) => character.name.trim().toLowerCase() === needle);
  return exact?.id ?? null;
}

function normalizeSpeechText(value: string): string {
  return value
    .replace(/^[「『“"'']+/, "")
    .replace(/[」』”"'']+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isNarrationSpeaker(speaker: string): boolean {
  return /^(narrator|旁白|note|notes|caption)$/i.test(speaker.trim());
}

function overlaps(
  left: { start: number; end: number },
  right: { start: number; end: number },
): boolean {
  return left.start < right.end && right.start < left.end;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
