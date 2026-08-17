import type { StudioAttributedSpeechLine } from "../domain";

export type DialogueShotRef = {
  id: string;
  action: string;
  purpose: string;
};

export type ShotDialogueAssignment = {
  shotId: string;
  lines: StudioAttributedSpeechLine[];
};

export function assignDialogueToShots(
  lines: readonly StudioAttributedSpeechLine[],
  shots: readonly DialogueShotRef[],
): ShotDialogueAssignment[] {
  if (shots.length === 0) {
    return [];
  }

  const buckets = new Map<string, StudioAttributedSpeechLine[]>();
  for (const shot of shots) {
    buckets.set(shot.id, []);
  }

  let cursor = 0;
  for (const line of lines) {
    const named = shots.findIndex(
      (shot, index) => index >= cursor && mentionsSpeaker(`${shot.purpose} ${shot.action}`, line.speaker),
    );
    const index = named >= 0 ? named : Math.min(cursor, shots.length - 1);
    const shot = shots[index]!;
    buckets.get(shot.id)!.push(line);
    cursor = Math.min(index + 1, shots.length - 1);
  }

  return shots.map((shot) => ({
    shotId: shot.id,
    lines: buckets.get(shot.id) ?? [],
  }));
}

function mentionsSpeaker(text: string, speaker: string): boolean {
  const trimmed = speaker.trim();
  if (trimmed.length < 2) {
    return false;
  }
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z])${escaped}(?=[^A-Za-z]|$)`, "i").test(text);
}
