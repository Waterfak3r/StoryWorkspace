import type { StudioAttributedSpeechLine, StudioLetteringBalloon } from "../domain";

export type PanelLetteringInput = {
  shotId: string;
  panelIndex: number;
  lines: readonly StudioAttributedSpeechLine[];
};

export function compilePageLettering(
  assignments: readonly PanelLetteringInput[],
): StudioLetteringBalloon[] {
  const balloons: StudioLetteringBalloon[] = [];
  for (const assignment of assignments) {
    for (const line of assignment.lines) {
      balloons.push({
        id: line.id,
        speaker: line.speaker,
        speakerId: line.speakerId,
        text: line.text,
        panelIndex: assignment.panelIndex,
        shotId: assignment.shotId,
        kind: "speech",
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
