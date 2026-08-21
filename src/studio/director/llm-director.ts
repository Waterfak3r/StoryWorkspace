import "server-only";

import { z } from "zod";

import { isTextProviderConfigured } from "../settings";
import { completeJsonWithFetch } from "../parse/complete-json";
import { defaultDirector, type DirectorShotDraft, type SceneDirector } from "./direct-scene";
import type { StudioScene } from "../domain";

const directorProposalSchema = z.strictObject({
  shots: z
    .array(
      z.strictObject({
        purpose: z.string().min(1),
        action: z.string().min(1),
        camera: z.string().min(1),
      }),
    )
    .min(2),
});

const DIRECTOR_SYSTEM = `You are a comic-book storyboard director. Turn the supplied structured scene evidence into cinematic stills.
Return JSON only with key "shots". Each shot needs purpose, action, camera.
Cameras must vary and name a framing or move: wide, medium, close-up, low angle, high angle, over-the-shoulder, insert, push-in, or hold.
Action must follow the supplied intent, entities, state summary, event summary, prior-story recap, and confirmed dialogue references; do not invent a new story.
Give important confirmed dialogue exchanges their own shots when present.
At least two shots. No secrets.`;

export type DirectorEvidence = {
  entities?: readonly {
    id: string;
    kind: string;
    name: string;
    description: string;
    outfit?: string;
    condition?: string;
    note?: string;
  }[];
  stateSummary?: string;
  eventSummary?: string;
  timeSummary?: string;
  storyPosition?: { events: { title: string; summary: string }[] };
};

export async function llmDirector(scene: StudioScene, evidence: DirectorEvidence = {}): Promise<DirectorShotDraft[]> {
  if (!isTextProviderConfigured()) {
    return defaultDirector(scene);
  }

  try {
    const raw = await completeJsonWithFetch(
      directorProposalSchema,
      [
        `Scene title: ${scene.title}`,
        `Intent: ${scene.intent || "(none)"}`,
        "Attached entities:",
        evidence.entities && evidence.entities.length > 0
          ? evidence.entities
              .map((entity) => {
                const state = [entity.outfit, entity.condition, entity.note].filter(Boolean).join("; ");
                return `- ${entity.id} | ${entity.kind} | ${entity.name} | ${entity.description}${state ? ` | state: ${state}` : ""}`;
              })
              .join("\n")
          : "- none",
        `State summary: ${evidence.stateSummary || "(none)"}`,
        `Time summary: ${evidence.timeSummary || "(none)"}`,
        `Event summary: ${evidence.eventSummary || scene.intent || "(none)"}`,
        "Prior story:",
        formatPriorStoryEvents(evidence.storyPosition?.events ?? []),
        "Confirmed dialogue:",
        scene.dialogue.lines.length > 0
          ? scene.dialogue.lines.map((line) => `- ${line.id} | ${line.speakerId ?? "narration"} | ${line.shotId ?? "unassigned"} | ${line.text}`).join("\n")
          : "- none",
      ].join("\n"),
      fetch,
      120_000,
      { systemPrompt: DIRECTOR_SYSTEM, schemaName: "studio_director_shots" },
    );
    const parsed = directorProposalSchema.safeParse(raw);
    if (!parsed.success) {
      return defaultDirector(scene);
    }
    return parsed.data.shots;
  } catch {
    return defaultDirector(scene);
  }
}

export function directorOrDefault(director?: SceneDirector): SceneDirector {
  return director ?? defaultDirector;
}

export function formatPriorStoryEvents(
  events: readonly { title: string; summary: string }[],
): string {
  if (events.length === 0) {
    return "- none";
  }
  return events
    .map((event) => {
      const summary = event.summary.replace(/\s+/g, " ").trim();
      return summary ? `- ${event.title}: ${summary}` : `- ${event.title}`;
    })
    .join("\n");
}
