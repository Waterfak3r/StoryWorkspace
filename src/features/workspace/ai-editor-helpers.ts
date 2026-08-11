export type AiSelectionSnapshot = {
  start: number;
  end: number;
  text: string;
  editSequence: number;
};

export type AiBodyCompositionMode = "insert" | "replace";

export function resolveInsertCaret(bodyLength: number, selectionStart: number | null | undefined, editorTouched: boolean) {
  if (!editorTouched || !Number.isFinite(selectionStart)) {
    return Math.max(0, bodyLength);
  }
  return Math.max(0, Math.min(selectionStart as number, Math.max(0, bodyLength)));
}

export function canApplyCanonicalAiAcceptance(canonicalBody: string, submittedBody: string, applySucceeded: boolean) {
  return applySucceeded && canonicalBody === submittedBody;
}

export function selectionStillMatches(body: string, editSequence: number, selection: AiSelectionSnapshot | null) {
  return Boolean(
    selection
    && selection.end > selection.start
    && selection.editSequence === editSequence
    && body.slice(selection.start, selection.end) === selection.text,
  );
}

export function composeAiBody(
  body: string,
  generatedMarkdown: string,
  mode: AiBodyCompositionMode,
  selection: AiSelectionSnapshot | null,
  caret: number,
  editSequence = selection?.editSequence ?? -1,
) {
  if (mode === "replace") {
    if (!selectionStillMatches(body, editSequence, selection)) {
      return null;
    }
    return body.slice(0, selection!.start) + generatedMarkdown + body.slice(selection!.end);
  }

  const safeCaret = Math.max(0, Math.min(caret, body.length));
  return body.slice(0, safeCaret) + generatedMarkdown + body.slice(safeCaret);
}
