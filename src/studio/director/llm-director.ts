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

const DIRECTOR_SYSTEM = `You are a comic-book storyboard director. Split the scene into cinematic stills.
Return JSON only with key "shots". Each shot needs purpose, action, camera.
Cameras must vary and name a framing or move: wide, medium, close-up, low angle, high angle, over-the-shoulder, insert, push-in, or hold.
Action must follow the scene plot wording, not invent a new story.
At least two shots. No secrets.`;

export async function llmDirector(scene: StudioScene): Promise<DirectorShotDraft[]> {
  if (!isTextProviderConfigured()) {
    return defaultDirector(scene);
  }

  try {
    const raw = await completeJsonWithFetch(
      directorProposalSchema,
      [
        `Scene title: ${scene.title}`,
        `Intent: ${scene.intent}`,
        "Plot:",
        scene.script || "The scene opens and then closes.",
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
