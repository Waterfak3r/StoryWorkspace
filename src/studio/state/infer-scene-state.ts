import "server-only";

import type { StudioContentStatePatch, StudioEntity } from "../domain";
import { listEntities, readContentState, writeContentState } from "../fs";
import { listScenesInStoryOrder, type LocatedStoryScene } from "./story-order";

export type { LocatedStoryScene };

export type InferredSceneState = {
  volumeId: string;
  chapterId: string;
  sceneId: string;
  patches: StudioContentStatePatch[];
};

const APPEARANCE_ALREADY_CHANGED =
  /\b(shorn|cropped|freshly cut|cut off|cut short|close-lying curls|curls that|bald|scarred|bandaged)\b/i;

const APPEARANCE_STILL_PRIOR = /buy my hair|sell my hair|sell her hair|hat off|hair fall|full length|cascade/i;

const APPEARANCE_CHANGE_IN_PROGRESS = /\b(buy my hair|sell my hair|sell her hair)\b/i;

export function inferSceneStatePatches(
  scenes: readonly LocatedStoryScene[],
  entities: readonly StudioEntity[],
): InferredSceneState[] {
  const characters = entities.filter((entity) => entity.kind === "character");
  const established = new Map<string, StudioContentStatePatch>();
  const inferred: InferredSceneState[] = [];

  for (let index = 0; index < scenes.length; index += 1) {
    const current = scenes[index]!;
    const previous = index > 0 ? scenes[index - 1] : undefined;
    const currentText = `${current.scene.intent}\n${current.scene.script}`;
    const previousText = previous ? `${previous.scene.intent}\n${previous.scene.script}` : "";

    for (const character of characters) {
      const onScene = new Set([
        ...current.scene.characters,
        ...(previous?.scene.characters ?? []),
      ]);
      if (!onScene.has(character.id)) {
        continue;
      }
      if (!characterOwnsAppearanceChange(currentText, character.name, APPEARANCE_ALREADY_CHANGED)) {
        continue;
      }
      if (established.has(character.id)) {
        established.set(
          character.id,
          appearancePatch(character.id, conditionFromText(currentText, APPEARANCE_ALREADY_CHANGED)),
        );
        continue;
      }
      if (!APPEARANCE_ALREADY_CHANGED.test(currentText) || APPEARANCE_ALREADY_CHANGED.test(previousText)) {
        continue;
      }
      established.set(
        character.id,
        appearancePatch(character.id, conditionFromText(currentText, APPEARANCE_ALREADY_CHANGED)),
      );
    }

    const hay = `${current.scene.intent}\n${current.scene.script}\n${current.scene.title}`;
    const stillPrior = /cascade|buy my hair|sell her hair|sells her hair|hat off|full length/i.test(hay);
    const patches = current.scene.characters
      .map((entityId) => established.get(entityId))
      .filter((patch): patch is StudioContentStatePatch => Boolean(patch))
      .filter((patch) => !(stillPrior && isAppearancePatch(patch)));
    if (patches.length > 0) {
      inferred.push({
        volumeId: current.volumeId,
        chapterId: current.chapterId,
        sceneId: current.scene.id,
        patches,
      });
    }

    for (const character of characters) {
      if (established.has(character.id)) {
        continue;
      }
      if (!current.scene.characters.includes(character.id)) {
        continue;
      }
      if (
        !APPEARANCE_CHANGE_IN_PROGRESS.test(currentText) ||
        !characterOwnsAppearanceChange(currentText, character.name, APPEARANCE_CHANGE_IN_PROGRESS)
      ) {
        continue;
      }
      established.set(character.id, appearancePatch(character.id, conditionFromText(currentText, APPEARANCE_CHANGE_IN_PROGRESS)));
    }
  }

  return inferred;
}

export function writeInferredSceneStates(projectId: string): InferredSceneState[] {
  const scenes = listStoryScenes(projectId);
  const entities = [
    ...listEntities(projectId, "character"),
    ...listEntities(projectId, "location"),
    ...listEntities(projectId, "prop"),
    ...listEntities(projectId, "costume"),
  ];
  const inferred = inferSceneStatePatches(scenes, entities);
  const inferredByScene = new Map(inferred.map((item) => [item.sceneId, item]));
  for (const located of scenes) {
    const existing = readContentState(projectId, located.volumeId, located.chapterId, located.scene.id);
    const canon = (existing?.patches ?? []).filter((patch) => patch.truth === "canon");
    const next = inferredByScene.get(located.scene.id);
    const patches = [...canon, ...(next?.patches ?? [])];
    if (!existing && patches.length === 0) {
      continue;
    }
    writeContentState(projectId, located.volumeId, located.chapterId, located.scene.id, {
      patches,
      expectedUpdatedAt: existing?.updatedAt,
    });
  }
  return inferred;
}

export function listStoryScenes(projectId: string): LocatedStoryScene[] {
  return listScenesInStoryOrder(projectId);
}

function appearancePatch(entityId: string, condition: string): StudioContentStatePatch {
  return {
    entityId,
    condition,
    truth: "inferred",
  };
}

function isAppearancePatch(patch: StudioContentStatePatch): boolean {
  return /\b(hair|curls?|shorn|cropp?ed|cut|bald|scar|bandage|sold)\b/i.test(patch.condition ?? "");
}

function conditionFromText(text: string, pattern: RegExp): string {
  const newline = text.indexOf("\n");
  const scriptPart = newline >= 0 ? text.slice(newline + 1) : text;
  const clause =
    hairClauses(scriptPart).find((item) => pattern.test(item)) ??
    hairClauses(text).find((item) => pattern.test(item));
  const source = (clause ?? text).replace(/\s+/g, " ").trim();
  if (APPEARANCE_CHANGE_IN_PROGRESS.test(source) && !APPEARANCE_ALREADY_CHANGED.test(source)) {
    return "hair cut";
  }
  if (source.length <= 96) {
    return source;
  }
  return `${source.slice(0, 95).trimEnd()}…`;
}

function characterOwnsAppearanceChange(text: string, name: string, pattern: RegExp): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    return false;
  }
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nameRe = new RegExp(`(^|[^A-Za-z])${escaped}(?=[^A-Za-z]|$)`, "i");
  const saidRe = new RegExp(`\\b(?:asked|said|cried|whispered)\\s+${escaped}\\b`, "i");
  for (const clause of hairClauses(text)) {
    if (!pattern.test(clause) || !nameRe.test(clause)) {
      continue;
    }
    const attributed = saidRe.test(clause);
    const ownBody = /\b(my|her) hair\b|\bher head\b/i.test(clause);
    const yourBody = /\byour hair\b/i.test(clause);
    if (attributed && yourBody && !ownBody) {
      continue;
    }
    if (attributed && ownBody) {
      return true;
    }
    if (nameRe.test(clause.replace(saidRe, " "))) {
      return true;
    }
  }
  return false;
}

function hairClauses(text: string): string[] {
  return text
    .split(/\s*,\s*and\s+|[.!]\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}
