import "server-only";

import { z } from "zod";

import type { StudioContentStatePatch, StudioEntity } from "../domain";
import { listEntities, readContentState, writeContentState } from "../fs";
import { completeJsonWithFetch } from "../parse/complete-json";
import { isTextProviderConfigured } from "../settings";
import { listScenesInStoryOrder, type LocatedStoryScene } from "./story-order";

export type { LocatedStoryScene };

export type InferredSceneState = {
  volumeId: string;
  chapterId: string;
  sceneId: string;
  patches: StudioContentStatePatch[];
};

const stateProposalPatchSchema = z
  .strictObject({
    sceneId: z.string().min(1),
    entityId: z.string().min(1),
    outfit: z.string().optional(),
    condition: z.string().optional(),
    note: z.string().optional(),
    supersedes: z.array(z.string().min(1)).default([]),
  })
  .refine(
    (value) =>
      value.outfit !== undefined ||
      value.condition !== undefined ||
      value.note !== undefined ||
      value.supersedes.length > 0,
    { message: "A state patch must contain at least one state field." },
  );

const stateProposalSchema = z.strictObject({
  patches: z.array(stateProposalPatchSchema),
});

const STATE_SYSTEM = `You propose scene-local story state from the supplied evidence.
Return JSON only with exactly one top-level key: "patches".
Each patch must reference an existing sceneId and an entityId attached to that scene.
Use only these fields: sceneId, entityId, outfit, condition, note, supersedes.
Each value must be a concise, evidence-grounded statement. Do not invent facts, identities, or chronology.
The entity's default identity is stable. Put only changes or scene-local conditions in a patch.
Use supersedes for exact identity-description fragments that no longer apply in this scene; copy those fragments verbatim when possible.
Return an empty patches array when the evidence does not establish a state change. No extra keys.`;

/** Deterministic fallback deliberately returns no inferred story facts. */
export function inferSceneStatePatches(
  _scenes: readonly LocatedStoryScene[],
  _entities: readonly StudioEntity[],
): InferredSceneState[] {
  return [];
}

export async function inferSceneStatePatchesWithLlm(
  scenes: readonly LocatedStoryScene[],
  entities: readonly StudioEntity[],
): Promise<InferredSceneState[]> {
  if (!isTextProviderConfigured() || scenes.length === 0 || entities.length === 0) {
    return [];
  }

  const attachedByScene = new Map(
    scenes.map((located) => [
      located.scene.id,
      new Set([
        ...located.scene.characters,
        ...(located.scene.location ? [located.scene.location] : []),
        ...located.scene.props,
        ...located.scene.costumes,
      ]),
    ]),
  );
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const prompt = [
    "Entity catalog:",
    ...entities.map(
      (entity) =>
        `- ${entity.id} | ${entity.kind} | ${entity.name} | default outfit: ${entity.states.default.outfit || "(none)"} | default condition: ${entity.states.default.condition || "(none)"}`,
    ),
    "Scenes in source order:",
    ...scenes.map((located, index) => {
      const scene = located.scene;
      const refs = [...(attachedByScene.get(scene.id) ?? [])].join(", ");
      return [
        `Scene ${index + 1}: ${scene.id}`,
        `title: ${scene.title}`,
        `intent: ${scene.intent || "(none)"}`,
        `attached entities: ${refs || "(none)"}`,
        `evidence script: ${scene.script || "(empty)"}`,
      ].join("\n");
    }),
  ].join("\n");

  let raw: unknown;
  try {
    raw = await completeJsonWithFetch(
      stateProposalSchema,
      prompt,
      fetch,
      120_000,
      { systemPrompt: STATE_SYSTEM, schemaName: "studio_scene_state_patches" },
    );
  } catch {
    return [];
  }

  const parsed = stateProposalSchema.safeParse(raw);
  if (!parsed.success) {
    return [];
  }

  const locatedById = new Map(scenes.map((located) => [located.scene.id, located]));
  const byScene = new Map<string, InferredSceneState>();
  for (const candidate of parsed.data.patches) {
    const located = locatedById.get(candidate.sceneId);
    const entity = entityById.get(candidate.entityId);
    if (!located || !entity || !attachedByScene.get(candidate.sceneId)?.has(candidate.entityId)) {
      continue;
    }
    const patch: StudioContentStatePatch = {
      entityId: candidate.entityId,
      ...(candidate.outfit !== undefined ? { outfit: candidate.outfit.trim() } : {}),
      ...(candidate.condition !== undefined ? { condition: candidate.condition.trim() } : {}),
      ...(candidate.note !== undefined ? { note: candidate.note.trim() } : {}),
      supersedes: [...new Set(candidate.supersedes.map((fragment) => fragment.trim()).filter(Boolean))],
      truth: "inferred",
    };
    if (
      patch.outfit === undefined &&
      patch.condition === undefined &&
      patch.note === undefined &&
      (patch.supersedes ?? []).length === 0
    ) {
      continue;
    }
    const existing = byScene.get(candidate.sceneId) ?? {
      volumeId: located.volumeId,
      chapterId: located.chapterId,
      sceneId: candidate.sceneId,
      patches: [],
    };
    const priorIndex = existing.patches.findIndex((item) => item.entityId === candidate.entityId);
    if (priorIndex >= 0) {
      existing.patches[priorIndex] = patch;
    } else {
      existing.patches.push(patch);
    }
    byScene.set(candidate.sceneId, existing);
  }

  return [...byScene.values()];
}

/** Replace stale inferred proposals while preserving Canon patches. */
export async function writeInferredSceneStatesAsync(projectId: string): Promise<InferredSceneState[]> {
  const scenes = listStoryScenes(projectId);
  const entities = [
    ...listEntities(projectId, "character"),
    ...listEntities(projectId, "location"),
    ...listEntities(projectId, "prop"),
    ...listEntities(projectId, "costume"),
  ];
  const inferred = await inferSceneStatePatchesWithLlm(scenes, entities);
  persistStateResults(projectId, scenes, inferred);
  return inferred;
}

/** Synchronous conservative path retained for existing callers and scripts. */
export function writeInferredSceneStates(projectId: string): InferredSceneState[] {
  const scenes = listStoryScenes(projectId);
  persistStateResults(projectId, scenes, []);
  return [];
}

export function listStoryScenes(projectId: string): LocatedStoryScene[] {
  return listScenesInStoryOrder(projectId);
}

function persistStateResults(
  projectId: string,
  scenes: readonly LocatedStoryScene[],
  inferred: readonly InferredSceneState[],
): void {
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
}
