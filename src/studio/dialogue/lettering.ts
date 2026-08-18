import type { LetteringAnchor, StudioAttributedSpeechLine, StudioLetteringBalloon } from "../domain";

export type PanelLetteringInput = {
  shotId: string;
  panelIndex: number;
  lines: readonly StudioAttributedSpeechLine[];
};

const SPEECH_ANCHORS = ["tl", "tr"] as const satisfies readonly LetteringAnchor[];
const NARRATION_ANCHORS = ["bl", "br"] as const satisfies readonly LetteringAnchor[];

export function compilePageLettering(
  assignments: readonly PanelLetteringInput[],
): StudioLetteringBalloon[] {
  const balloons: StudioLetteringBalloon[] = [];
  for (const assignment of assignments) {
    let speechIndex = 0;
    let narrationIndex = 0;
    for (const line of assignment.lines) {
      const kind = line.kind ?? "speech";
      const anchors = kind === "narration" ? NARRATION_ANCHORS : SPEECH_ANCHORS;
      const index = kind === "narration" ? narrationIndex++ : speechIndex++;
      balloons.push({
        id: line.id,
        speaker: line.speaker,
        speakerId: line.speakerId,
        text: line.text,
        panelIndex: assignment.panelIndex,
        shotId: assignment.shotId,
        kind,
        anchor: anchors[Math.min(index, anchors.length - 1)]!,
      });
    }
  }
  return balloons;
}

export function speechByShotId(
  assignments: readonly { shotId: string; lines: readonly StudioAttributedSpeechLine[] }[],
): Record<string, StudioAttributedSpeechLine[]> {
  const mapped: Record<string, StudioAttributedSpeechLine[]> = {};
  for (const assignment of assignments) {
    mapped[assignment.shotId] = [...assignment.lines];
  }
  return mapped;
}
