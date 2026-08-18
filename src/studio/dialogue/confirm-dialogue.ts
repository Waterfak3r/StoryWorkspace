import "server-only";

import { z } from "zod";

import type {
  StudioAttributedSpeechLine,
  StudioEntity,
  StudioScene,
  StudioSceneDialogueLine,
} from "../domain";
import { readEntity, readScene, readTree, updateScene } from "../fs";
import { timelineEventId } from "../outline/build-timeline";
import { completeJsonWithFetch } from "../parse/complete-json";
import { isTextProviderConfigured } from "../settings";
import { assignDialogueToShots, scoreLineAgainstShot, type DialogueShotRef } from "./assign-dialogue";
import {
  extractAttributedDialogue,
  isScriptSubstring,
  normalizeSpeechText,
  unicodeLength,
  type DialogueCharacterRef,
} from "./extract-dialogue";

const MAX_SPEECH_PER_SHOT = 5;
const MAX_NARRATION_PER_SHOT = 1;
const NARRATION_TEXT_MAX = 40;

const llmDialogueLineSchema = z.strictObject({
  kind: z.enum(["speech", "narration"]),
  speakerId: z.string().nullable(),
  speaker: z.string().min(1),
  text: z.string().min(1),
  shotId: z.string().nullable(),
});

const llmDialogueProposalSchema = z.strictObject({
  lines: z.array(llmDialogueLineSchema),
});

const DIALOGUE_SYSTEM = `You extract comic speech and short narration from an original scene script.
Return JSON only with key "lines".
Each line needs kind, speakerId, speaker, text, shotId.
kind is "speech" or "narration".
speech speakerId must be one of the listed character ids. speaker is that character's name.
The speaker is the person who utters the line, not the person addressed. A name at the start or end of a line may be a vocative; use attribution verbs and nearby evidence to identify the utterer.
Do not extract nameplates, labels, titles, or signs as speech.
Keep a quoted sentence together. Do not split one sentence into multiple speakers.
narration speakerId must be null. speaker may be 旁白 or narrator. Narration is a short time/place/voice-over, at most 40 characters. Do not extract long description.
text must be a verbatim substring of the script. Do not paraphrase or invent wording.
shotId may be a listed shot id or null; preserve a valid shotId when the evidence supports it.
No extra keys. No secrets.`;

type DialogueCandidate = StudioAttributedSpeechLine & { shotId: string | null };

export async function confirmSceneDialogue(
  projectId: string,
  volumeId: string,
  chapterId: string,
  sceneId: string,
): Promise<StudioScene> {
  const scene = readScene(projectId, volumeId, chapterId, sceneId);
  const characters = loadSceneCharacters(projectId, scene.characters);
  const eventId = timelineEventId({ volumeId, chapterId, sceneId });
  const extracted = await extractSceneDialogue(scene, characters);
  const lines = assignConfirmedLines(extracted, scene.shots, eventId);

  return updateScene(projectId, volumeId, chapterId, sceneId, {
    dialogue: {
      status: "confirmed",
      lines,
      confirmedAt: new Date().toISOString(),
    },
    expectedUpdatedAt: scene.updatedAt,
  });
}

export async function confirmProjectDialogue(projectId: string): Promise<StudioScene[]> {
  const tree = readTree(projectId);
  const scenes: StudioScene[] = [];

  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      for (const sceneNode of chapter.scenes) {
        const scene = readScene(projectId, volume.id, chapter.id, sceneNode.id);
        if (scene.shots.length === 0) {
          continue;
        }
        scenes.push(await confirmSceneDialogue(projectId, volume.id, chapter.id, scene.id));
      }
    }
  }

  return scenes;
}

export function confirmedSpeechByShot(
  scene: StudioScene,
): Record<string, StudioAttributedSpeechLine[]> {
  const mapped: Record<string, StudioAttributedSpeechLine[]> = {};
  if (scene.dialogue.status !== "confirmed") {
    return mapped;
  }

  for (const line of scene.dialogue.lines) {
    if (!line.shotId) {
      continue;
    }
    (mapped[line.shotId] ??= []).push(toSpeechLine(line));
  }
  return mapped;
}

export function confirmedUnassignedLines(scene: StudioScene): StudioAttributedSpeechLine[] {
  if (scene.dialogue.status !== "confirmed") {
    return [];
  }
  return scene.dialogue.lines.filter((line) => line.shotId === null).map(toSpeechLine);
}

export function sceneHasUnassignedSpeech(scene: StudioScene): boolean {
  return (
    scene.dialogue.status === "confirmed" &&
    scene.dialogue.lines.some((line) => (line.kind ?? "speech") !== "narration" && line.shotId === null)
  );
}

export function reassignSceneDialogue(
  projectId: string,
  volumeId: string,
  chapterId: string,
  sceneId: string,
): StudioScene {
  const scene = readScene(projectId, volumeId, chapterId, sceneId);
  if (scene.dialogue.status !== "confirmed" || scene.shots.length === 0) {
    return scene;
  }
  const eventId =
    scene.dialogue.lines.find((line) => line.eventId?.trim())?.eventId ??
    timelineEventId({ volumeId, chapterId, sceneId });
  const lines = assignConfirmedLines(
    scene.dialogue.lines.map(toDialogueCandidate),
    scene.shots,
    eventId,
  );
  return updateScene(projectId, volumeId, chapterId, sceneId, {
    dialogue: {
      status: "confirmed",
      lines,
      confirmedAt: scene.dialogue.confirmedAt ?? new Date().toISOString(),
    },
    expectedUpdatedAt: scene.updatedAt,
  });
}

async function extractSceneDialogue(
  scene: StudioScene,
  characters: readonly DialogueCharacterRef[],
): Promise<DialogueCandidate[]> {
  const quoted = extractAttributedDialogue(scene.script, characters).map((line) => ({ ...line, shotId: null }));
  if (!isTextProviderConfigured()) {
    return quoted;
  }
  try {
    // The provider is the semantic path. The deterministic extractor is only a
    // conservative fallback when the provider is unavailable or fails.
    return await extractDialogueWithLlm(scene, characters);
  } catch {
    return quoted;
  }
}

async function extractDialogueWithLlm(
  scene: StudioScene,
  characters: readonly DialogueCharacterRef[],
): Promise<DialogueCandidate[]> {
  const raw = await completeJsonWithFetch(
    llmDialogueProposalSchema,
    [
      "Characters:",
      characters.length > 0
        ? characters.map((character) => `- ${character.id}: ${character.name}`).join("\n")
        : "- none",
      `Intent: ${scene.intent || "(none)"}`,
      "Shots:",
      scene.shots.length > 0
        ? scene.shots.map((shot) => `- ${shot.id} | ${shot.purpose} | ${shot.action}`).join("\n")
        : "- none",
      "Script:",
      scene.script || "(empty)",
    ].join("\n"),
    fetch,
    120_000,
    { systemPrompt: DIALOGUE_SYSTEM, schemaName: "studio_dialogue_lines" },
  );
  const parsed = llmDialogueProposalSchema.safeParse(raw);
  if (!parsed.success) {
    return [];
  }

  const accepted: DialogueCandidate[] = [];
  const knownIds = new Set(characters.map((character) => character.id));
  const knownShotIds = new Set(scene.shots.map((shot) => shot.id));
  for (const line of parsed.data.lines) {
    const text = normalizeSpeechText(line.text);
    if (!text || !isScriptSubstring(text, scene.script)) {
      continue;
    }
    if (line.kind === "narration") {
      if (unicodeLength(text) > NARRATION_TEXT_MAX) {
        continue;
      }
      accepted.push({
        id: `line-${String(accepted.length + 1).padStart(2, "0")}`,
        speaker: line.speaker.trim() || "旁白",
        speakerId: null,
        text,
        kind: "narration",
        eventId: "",
        shotId: line.shotId && knownShotIds.has(line.shotId) ? line.shotId : null,
      });
      continue;
    }
    if (!line.speakerId || !knownIds.has(line.speakerId)) {
      continue;
    }
    const character = characters.find((item) => item.id === line.speakerId);
    if (!character) {
      continue;
    }
    accepted.push({
      id: `line-${String(accepted.length + 1).padStart(2, "0")}`,
      speaker: character.name,
      speakerId: character.id,
      text,
      kind: "speech",
      eventId: "",
      shotId: line.shotId && knownShotIds.has(line.shotId) ? line.shotId : null,
    });
  }
  return accepted;
}

function assignConfirmedLines(
  extracted: readonly DialogueCandidate[],
  shots: StudioScene["shots"],
  eventId: string,
): StudioSceneDialogueLine[] {
  const validShotIds = new Set(shots.map((shot) => shot.id));
  const stamped = extracted.map((line) => ({
    ...line,
    kind: line.kind ?? "speech",
    eventId,
    shotId: line.shotId && validShotIds.has(line.shotId) ? line.shotId : null,
  }));

  if (shots.length === 0) {
    return stamped.map((line) => ({ ...line, shotId: null }));
  }

  const assigned = assignDialogueToShots(stamped, shots);
  const used = new Map<string, { speech: number; narration: number }>();
  for (const shot of shots) {
    used.set(shot.id, { speech: 0, narration: 0 });
  }

  const kept: StudioSceneDialogueLine[] = [];
  const overflow: DialogueCandidate[] = [];

  for (const assignment of assigned) {
    for (const line of assignment.lines) {
      const kind = line.kind ?? "speech";
      const next: DialogueCandidate = { ...line, kind, eventId, shotId: line.shotId ?? null };
      const preferredShotId = next.shotId && validShotIds.has(next.shotId) ? next.shotId : assignment.shotId;
      if (tryPlaceLine(kept, used, next, eventId, preferredShotId)) {
        continue;
      }
      overflow.push(next);
    }
  }

  const shotRefs: DialogueShotRef[] = shots.map((shot) => ({
    id: shot.id,
    action: shot.action,
    purpose: shot.purpose,
  }));
  for (const line of overflow) {
    const placed = placeOverflowLine(kept, used, line, eventId, shotRefs);
    if (!placed) {
      kept.push({ ...line, kind: line.kind ?? "speech", eventId, shotId: null });
    }
  }

  return kept;
}

function tryPlaceLine(
  kept: StudioSceneDialogueLine[],
  used: Map<string, { speech: number; narration: number }>,
  line: StudioAttributedSpeechLine,
  eventId: string,
  shotId: string,
): boolean {
  const bucket = used.get(shotId);
  if (!bucket) {
    return false;
  }
  const kind = line.kind ?? "speech";
  if (kind === "narration" ? bucket.narration >= MAX_NARRATION_PER_SHOT : bucket.speech >= MAX_SPEECH_PER_SHOT) {
    return false;
  }
  if (kind === "narration") {
    bucket.narration += 1;
  } else {
    bucket.speech += 1;
  }
  kept.push({ ...line, kind, eventId, shotId });
  return true;
}

function placeOverflowLine(
  kept: StudioSceneDialogueLine[],
  used: Map<string, { speech: number; narration: number }>,
  line: StudioAttributedSpeechLine,
  eventId: string,
  shots: readonly DialogueShotRef[],
): boolean {
  const ranked = shots
    .map((shot) => ({ shot, score: scoreLineAgainstShot(line.text, shot) }))
    .sort((left, right) => right.score - left.score || shots.indexOf(left.shot) - shots.indexOf(right.shot));
  for (const shot of [...ranked.map((item) => item.shot), ...shots]) {
    if (tryPlaceLine(kept, used, line, eventId, shot.id)) {
      return true;
    }
  }
  return false;
}

function toSpeechLine(line: StudioSceneDialogueLine): StudioAttributedSpeechLine {
  return {
    id: line.id,
    speaker: line.speaker,
    speakerId: line.speakerId,
    text: line.text,
    kind: line.kind ?? "speech",
    eventId: line.eventId ?? "",
  };
}

function toDialogueCandidate(line: StudioSceneDialogueLine): DialogueCandidate {
  return { ...toSpeechLine(line), shotId: line.shotId };
}

function loadSceneCharacters(projectId: string, ids: readonly string[]) {
  return ids
    .map((id) => tryReadCharacter(projectId, id))
    .filter((entity): entity is { id: string; name: string } => entity !== null);
}

function tryReadCharacter(projectId: string, entityId: string): { id: string; name: string } | null {
  let entity: StudioEntity;
  try {
    entity = readEntity(projectId, entityId);
  } catch {
    return null;
  }
  if (entity.kind !== "character") {
    return null;
  }
  return { id: entity.id, name: entity.name };
}
