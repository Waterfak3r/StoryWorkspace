import type { StudioAttributedSpeechLine } from "../domain";

export type DialogueCharacterRef = {
  id: string;
  name: string;
};

const ATTRIBUTION_VERBS =
  "said|says|asked|asks|whispered|whispers|cried|cries|shouted|shouts|replied|replies|answered|answers|muttered|mutters|yelled|yells|called|calls";

const NARRATION_TEXT_MAX = 40;

type FoundLine = {
  start: number;
  end: number;
  speaker: string;
  speakerId: string | null;
  body: string;
  kind: "speech" | "narration";
};

export function extractAttributedDialogue(
  script: string,
  characters: readonly DialogueCharacterRef[],
): StudioAttributedSpeechLine[] {
  const text = script.replace(/\r\n/g, "\n");
  if (!text.trim()) {
    return [];
  }

  const found: FoundLine[] = [];
  collectColonLines(text, characters, found);
  collectQuotedSpeech(text, characters, found);
  collectSaidBeforeQuote(text, characters, found);
  collectQuoteThenSaid(text, characters, found);
  collectQuoteThenNameVerb(text, characters, found);
  collectChineseSaid(text, characters, found);

  found.sort((left, right) => left.start - right.start || right.end - left.end);
  const unique: FoundLine[] = [];
  for (const hit of found) {
    if (unique.some((prior) => overlaps(prior, hit))) {
      continue;
    }
    unique.push(hit);
  }
  const mergedQuotes = mergeSplitSpeech(unique, text);
  const kept: FoundLine[] = [];
  for (const hit of mergedQuotes) {
    if (kept.some((prior) => overlaps(prior, hit))) {
      continue;
    }
    const body = normalizeSpeechText(hit.body);
    if (!body) {
      continue;
    }
    if (hit.kind === "narration") {
      if (unicodeLength(body) > NARRATION_TEXT_MAX) {
        continue;
      }
      kept.push({ ...hit, speaker: hit.speaker.trim() || "旁白", speakerId: null, body });
      continue;
    }
    const speaker = hit.speaker.trim();
    if (!speaker) {
      continue;
    }
    kept.push({ ...hit, speaker, body });
  }

  if (kept.length === 0) {
    const caption = establishCaption(text);
    if (caption) {
      kept.push({
        start: 0,
        end: caption.length,
        speaker: "旁白",
        speakerId: null,
        body: caption,
        kind: "narration",
      });
    }
  }

  const extracted: StudioAttributedSpeechLine[] = kept.flatMap((hit, index): StudioAttributedSpeechLine[] => {
      if (hit.kind === "narration") {
        return [{
          id: `line-${String(index + 1).padStart(2, "0")}`,
          speaker: hit.speaker.trim() || "旁白",
          speakerId: null,
          text: hit.body,
          kind: hit.kind,
          eventId: "",
        }];
      }
      const speakerId = hit.speakerId ?? resolveSpeakerId(hit.speaker, characters);
      const canonical = speakerId ? characters.find((character) => character.id === speakerId) : null;
      if (!canonical) {
        return [];
      }
      return [{
        id: `line-${String(index + 1).padStart(2, "0")}`,
        speaker: canonical.name,
        speakerId,
        text: hit.body,
        kind: hit.kind,
        eventId: "",
      }];
    }).map((line, index) => ({
      ...line,
      id: `line-${String(index + 1).padStart(2, "0")}`,
    }));
  return correctVocativeLines(extracted, characters);
}

export function correctVocativeLines(
  lines: readonly StudioAttributedSpeechLine[],
  characters: readonly DialogueCharacterRef[],
): StudioAttributedSpeechLine[] {
  return lines.map((line, index) => {
    if ((line.kind ?? "speech") === "narration" || !line.speakerId) {
      return line;
    }
    const current = characters.find((character) => character.id === line.speakerId) ?? null;
    if (!current) {
      return line;
    }
    const previous = lines
      .slice(0, index)
      .reverse()
      .find((item) => (item.kind ?? "speech") === "speech" && item.speakerId);
    const lastSpeech = previous
      ? characters.find((character) => character.id === previous.speakerId) ?? null
      : null;
    const priorSpeech =
      lastSpeech &&
      lines
        .slice(0, index)
        .reverse()
        .map((item) => characters.find((character) => character.id === item.speakerId) ?? null)
        .find((character) => character && character.id !== lastSpeech.id);
    const next = rejectVocativeSpeaker(line.text, current, characters, lastSpeech, priorSpeech ?? null);
    const chosen = next;
    if (!chosen || chosen.id === current.id) {
      return line;
    }
    return { ...line, speaker: chosen.name, speakerId: chosen.id };
  });
}

export function normalizeSpeechText(value: string): string {
  return value
    .replace(/^[「『“"'']+/, "")
    .replace(/[」』”"'']+$/, "")
    .replace(/[，,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function mergeExtractedDialogue(
  primary: readonly StudioAttributedSpeechLine[],
  extra: readonly StudioAttributedSpeechLine[],
): StudioAttributedSpeechLine[] {
  const merged = [...primary];
  for (const line of extra) {
    const needle = normalizeForMatch(line.text);
    if (!needle) {
      continue;
    }
    const covered = merged.some((item) => {
      const hay = normalizeForMatch(item.text);
      return hay === needle || hay.includes(needle) || needle.includes(hay);
    });
    if (covered) {
      continue;
    }
    merged.push({
      ...line,
      id: `line-${String(merged.length + 1).padStart(2, "0")}`,
    });
  }
  return merged.map((line, index) => ({
    ...line,
    id: `line-${String(index + 1).padStart(2, "0")}`,
  }));
}

export function isScriptSubstring(text: string, script: string): boolean {
  const needle = normalizeForMatch(text);
  if (!needle) {
    return false;
  }
  const hay = normalizeForMatch(script);
  return hay.includes(needle);
}

export function unicodeLength(value: string): number {
  return Array.from(value).length;
}

function collectColonLines(
  script: string,
  characters: readonly DialogueCharacterRef[],
  found: FoundLine[],
) {
  const pattern = /^[ \t]*([^\n:：]{1,40}?)[ \t]*[:：][ \t]*([「『“"']?)(.+?)\2?[ \t]*$/gm;
  for (const match of script.matchAll(pattern)) {
    const speaker = (match[1] ?? "").trim();
    const body = (match[3] ?? "").trim();
    if (!speaker || !body) {
      continue;
    }
    const start = match.index ?? 0;
    if (isNarrationSpeaker(speaker)) {
      found.push({
        start,
        end: start + match[0].length,
        speaker,
        speakerId: null,
        body,
        kind: "narration",
      });
      continue;
    }
    found.push({
      start,
      end: start + match[0].length,
      speaker,
      speakerId: resolveSpeakerId(speaker, characters),
      body,
      kind: "speech",
    });
  }
}

const QUOTE_BODY = "([^「『“」』”\"]{1,400})";
const FILLER_BETWEEN = /^(then|later|after a while|afterward|meanwhile)[:.]?$/i;

function mergeSplitSpeech(found: FoundLine[], script: string): FoundLine[] {
  const merged: FoundLine[] = [];
  for (const hit of found) {
    const previous = merged[merged.length - 1];
    const between = previous ? script.slice(previous.end, hit.start) : "";
    const sameSpeaker =
      Boolean(previous?.speakerId && hit.speakerId && previous.speakerId === hit.speakerId) ||
      Boolean(previous && previous.speaker && hit.speaker && previous.speaker === hit.speaker);
    if (
      previous &&
      previous.kind === "speech" &&
      hit.kind === "speech" &&
      sameSpeaker &&
      isAttributionBetween(between)
    ) {
      previous.body = `${normalizeSpeechText(previous.body)} ${normalizeSpeechText(hit.body)}`.trim();
      previous.end = hit.end;
      continue;
    }
    merged.push({ ...hit });
  }
  return merged;
}

const ATTRIBUTION_BETWEEN =
  /^(?:,\s*)?(?:(?:[A-Z][A-Za-z.'-]+)\s+)?(?:said|says|asked|asks|cried|cries|whispered|whispers|replied|replies|answered|answers|muttered|mutters|shouted|shouts|yelled|yells|called|calls)?(?:\s*to\s+\w+)?[,.]?$/i;

const ATTRIBUTION_MARK =
  /said|says|asked|asks|cried|cries|whispered|whispers|replied|replies|answered|answers|muttered|mutters|shouted|shouts|yelled|yells|called|calls|\bto\s+\w+/i;

function isAttributionBetween(raw: string): boolean {
  if (/\n\s*\n/.test(raw)) {
    return false;
  }
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) {
    return true;
  }
  return ATTRIBUTION_BETWEEN.test(text) && ATTRIBUTION_MARK.test(text);
}

function collectQuotedSpeech(
  script: string,
  characters: readonly DialogueCharacterRef[],
  found: FoundLine[],
) {
  const quoteRe = new RegExp(`[「『“"]${QUOTE_BODY}[」』”"]`, "g");
  let lastSpeech: DialogueCharacterRef | null = null;
  let priorSpeech: DialogueCharacterRef | null = null;
  let lastEnd = 0;
  for (const match of script.matchAll(quoteRe)) {
    const body = match[1] ?? "";
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const rawBetween = script.slice(lastEnd, start);
    const attributed = speakerAroundQuote(script, start, end, characters);
    const between = stripAttributionResidue(rawBetween, characters);
    const spoken = normalizeSpeechText(body);
    const paragraphBreak = /\n\s*\n/.test(rawBetween);
    if (isNameplateQuote(spoken) && !attributed) {
      lastEnd = end;
      continue;
    }
    let speaker = attributed;
    if (!speaker && lastSpeech && isAttributionBetween(rawBetween)) {
      speaker = lastSpeech;
    } else if (!speaker && lastSpeech && between && isFillerBetween(between)) {
      speaker = lastSpeech;
    } else if (!speaker && lastSpeech && !between && !paragraphBreak) {
      speaker = lastSpeech;
    } else if (!speaker && lastSpeech && !between && paragraphBreak) {
      speaker = turnTakingSpeaker(lastSpeech, priorSpeech, characters);
    } else if (!speaker) {
      speaker =
        speakerFromProse(between, characters) ??
        turnTakingSpeaker(lastSpeech, priorSpeech, characters) ??
        (characters.length === 1 ? characters[0]! : null);
    }
    speaker = rejectVocativeSpeaker(spoken, speaker, characters, lastSpeech, priorSpeech);
    if (!speaker) {
      lastEnd = end;
      continue;
    }
    found.push({
      start,
      end,
      speaker: speaker.name,
      speakerId: speaker.id,
      body,
      kind: "speech",
    });
    if (lastSpeech && lastSpeech.id !== speaker.id) {
      priorSpeech = lastSpeech;
    }
    lastSpeech = speaker;
    lastEnd = end;
  }
}

function speakerAroundQuote(
  script: string,
  start: number,
  end: number,
  characters: readonly DialogueCharacterRef[],
): DialogueCharacterRef | null {
  const after = script.slice(end, end + 96);
  const before = script.slice(Math.max(0, start - 96), start);
  const names = nameAlternation(characters);
  const afterNameVerb = after.match(
    new RegExp(`^\\s*[,，:]?\\s*(?:(?:${ATTRIBUTION_VERBS})\\s+(${names})|(${names})\\s+(?:${ATTRIBUTION_VERBS}))\\b`, "i"),
  );
  if (afterNameVerb) {
    const named = (afterNameVerb[1] ?? afterNameVerb[2] ?? "").trim();
    if (named) {
      const id = resolveSpeakerId(named, characters);
      const character = characters.find((item) => item.id === id);
      if (character) {
        return character;
      }
    }
  }
  const beforeName = before.match(
    new RegExp(`\\b(${names})\\s+(?:${ATTRIBUTION_VERBS})[,，:]?\\s*$`, "i"),
  );
  if (beforeName?.[1]) {
    const id = resolveSpeakerId(beforeName[1], characters);
    return characters.find((item) => item.id === id) ?? null;
  }
  return null;
}

function speakerFromProse(
  between: string,
  characters: readonly DialogueCharacterRef[],
): DialogueCharacterRef | null {
  if (!between) {
    return null;
  }
  const names = [...characters].sort((left, right) => right.name.length - left.name.length);
  let last: DialogueCharacterRef | null = null;
  const hay = ` ${between} `;
  for (const character of names) {
    const name = character.name.trim();
    if (name.length < 2) {
      continue;
    }
    const pattern = new RegExp(`(^|[^A-Za-z])${escapeRegExp(name)}(?=[^A-Za-z]|$)`, "i");
    if (pattern.test(hay)) {
      last = character;
    }
  }
  return last;
}

function turnTakingSpeaker(
  lastSpeech: DialogueCharacterRef | null,
  priorSpeech: DialogueCharacterRef | null,
  characters: readonly DialogueCharacterRef[],
): DialogueCharacterRef | null {
  if (!lastSpeech) {
    return null;
  }
  if (priorSpeech && priorSpeech.id !== lastSpeech.id) {
    return priorSpeech;
  }
  if (characters.length === 2) {
    return characters.find((character) => character.id !== lastSpeech.id) ?? null;
  }
  return null;
}

function isFillerBetween(between: string): boolean {
  if (!between) {
    return true;
  }
  return FILLER_BETWEEN.test(between);
}

function stripAttributionResidue(raw: string, characters: readonly DialogueCharacterRef[]): string {
  const names = nameAlternation(characters);
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(new RegExp(`^(?:${ATTRIBUTION_VERBS})\\s+(?:${names})\\.?$`, "i"), "")
    .replace(new RegExp(`^(?:${names})\\s+(?:${ATTRIBUTION_VERBS})\\.?$`, "i"), "")
    .replace(/^[,\s]+/, "")
    .trim();
}

function isNameplateQuote(body: string): boolean {
  const trimmed = body.replace(/[.!]+$/g, "").trim();
  if (!trimmed || /[?!]/.test(body)) {
    return false;
  }
  if (/^(mr|mrs|miss|ms|dr)\.?\s+[A-Z][A-Za-z.\- ]+$/i.test(trimmed) && trimmed.split(/\s+/).length <= 6) {
    return true;
  }
  return /^[A-Z][a-z]+(?:\s+[A-Z][a-z.]+){2,}$/.test(trimmed) && trimmed.split(/\s+/).length <= 6;
}

function rejectVocativeSpeaker(
  body: string,
  speaker: DialogueCharacterRef | null,
  characters: readonly DialogueCharacterRef[],
  lastSpeech: DialogueCharacterRef | null,
  priorSpeech: DialogueCharacterRef | null,
): DialogueCharacterRef | null {
  if (!speaker) {
    return speaker;
  }
  const vocative = characters.find((character) =>
    nameVariants(character.name).some((variant) => {
      if (variant.length < 2) {
        return false;
      }
      const start = new RegExp(`^${escapeRegExp(variant)}\\b[,!?]`, "i");
      const mid = new RegExp(`[,，]\\s*${escapeRegExp(variant)}\\b`, "i");
      return start.test(body.trim()) || mid.test(body.trim());
    }),
  );
  if (!vocative || vocative.id !== speaker.id) {
    return speaker;
  }
  if (lastSpeech && lastSpeech.id !== speaker.id) {
    return lastSpeech;
  }
  return turnTakingSpeaker(speaker, priorSpeech, characters) ?? speaker;
}

function collectQuoteThenNameVerb(
  script: string,
  characters: readonly DialogueCharacterRef[],
  found: FoundLine[],
) {
  const names = nameAlternation(characters);
  const pattern = new RegExp(
    `[「『“"]${QUOTE_BODY}[」』”"][,，]?\\s+(${names})\\s+(?:${ATTRIBUTION_VERBS})\\b`,
    "gi",
  );
  pushNamedMatches(script, pattern, 2, 1, characters, found);
}

function collectSaidBeforeQuote(
  script: string,
  characters: readonly DialogueCharacterRef[],
  found: FoundLine[],
) {
  const names = nameAlternation(characters);
  const pattern = new RegExp(
    `\\b(${names})\\b\\s+(?:${ATTRIBUTION_VERBS})[,，]?\\s*[「『“"]([^」』”"]{1,240})[」』”"]`,
    "gi",
  );
  pushNamedMatches(script, pattern, 1, 2, characters, found);
}

function collectQuoteThenSaid(
  script: string,
  characters: readonly DialogueCharacterRef[],
  found: FoundLine[],
) {
  const names = nameAlternation(characters);
  const pattern = new RegExp(
    `[「『“"]([^」』”"]{1,240})[」』”"][,，]?\\s+(?:${ATTRIBUTION_VERBS})\\s+(${names})\\b`,
    "gi",
  );
  pushNamedMatches(script, pattern, 2, 1, characters, found);
}

function collectChineseSaid(
  script: string,
  characters: readonly DialogueCharacterRef[],
  found: FoundLine[],
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
  pushNamedMatches(script, before, 1, 2, characters, found);
  pushNamedMatches(script, after, 2, 1, characters, found);
}

function pushNamedMatches(
  script: string,
  pattern: RegExp,
  speakerIndex: number,
  bodyIndex: number,
  characters: readonly DialogueCharacterRef[],
  found: FoundLine[],
) {
  for (const match of script.matchAll(pattern)) {
    const speaker = (match[speakerIndex] ?? "").trim();
    const body = (match[bodyIndex] ?? "").trim();
    if (!speaker || !body) {
      continue;
    }
    const start = match.index ?? 0;
    found.push({
      start,
      end: start + match[0].length,
      speaker,
      speakerId: resolveSpeakerId(speaker, characters),
      body,
      kind: "speech",
    });
  }
}

function nameVariants(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) {
    return [];
  }
  const variants = [trimmed];
  if (trimmed.length >= 4 && /a$/i.test(trimmed)) {
    variants.push(trimmed.slice(0, -1));
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return variants;
  }
  variants.push(parts[parts.length - 1]!);
  if (/^(mr|mrs|miss|ms|dr|madame|mme|madam)\.?$/i.test(parts[0]!)) {
    variants.push(parts[0]!.replace(/\.$/, ""), parts.slice(1).join(" "));
  }
  return [...new Set(variants.filter((item) => item.length >= 2))];
}

function nameAlternation(characters: readonly DialogueCharacterRef[]): string {
  const names = characters
    .flatMap((character) => nameVariants(character.name))
    .filter((name) => name.length > 0)
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp);
  return names.length > 0 ? names.join("|") : "[A-Z][\\w.\\-]*";
}

function resolveSpeakerId(speaker: string, characters: readonly DialogueCharacterRef[]): string | null {
  const needle = speaker.trim().toLowerCase();
  const exact = characters.find((character) =>
    nameVariants(character.name).some((variant) => variant.toLowerCase() === needle),
  );
  return exact?.id ?? null;
}

function isNarrationSpeaker(speaker: string): boolean {
  return /^(narrator|narration|旁白|note|notes|caption)$/i.test(speaker.trim());
}

function normalizeForMatch(value: string): string {
  return value
    .replace(/[「『“”"'']/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function establishCaption(script: string): string | null {
  const window = script.slice(0, 400);
  const phrases = [...window.matchAll(/\b[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)+\b/g)].map((match) => match[0]);
  const best = phrases.sort((left, right) => right.length - left.length)[0];
  if (!best || unicodeLength(best) > NARRATION_TEXT_MAX || isNameplateQuote(best)) {
    return null;
  }
  return best;
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
