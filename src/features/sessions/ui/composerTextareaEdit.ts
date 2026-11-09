/** Edits the textarea the way typing would, so React and every draft listener see it. */
export function applyTextareaEdit(el: HTMLTextAreaElement, text: string, caret: number) {
  el.value = text;
  el.setSelectionRange(caret, caret);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Inserts spoken or generated text at the caret, separated from neighboring words. */
export function insertAtCaret(el: HTMLTextAreaElement, text: string) {
  const start = el.selectionStart ?? el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(el.selectionEnd ?? start);
  const inserted = `${before && !/\s$/.test(before) ? " " : ""}${text}`;
  const tail = after && !/^\s/.test(after) ? " " : "";
  applyTextareaEdit(el, before + inserted + tail + after, before.length + inserted.length);
}

/** The live dictation preview in a textarea: its range, exact text and dictation run. */
const dictationPreviews = new WeakMap<
  HTMLTextAreaElement,
  { start: number; end: number; text: string; run: object }
>();

/**
 * Inserts dictated text at the caret. A preview (`final: false`) is replaced in
 * place by the next text of the same dictation run, as long as it is unedited;
 * otherwise the preview stays as typed text and the new text goes to the caret.
 */
export function insertDictatedText(
  el: HTMLTextAreaElement,
  text: string,
  final: boolean,
  run: object,
) {
  const live = dictationPreviews.get(el);
  dictationPreviews.delete(el);
  if (live?.run === run && el.value.slice(live.start, live.end) === live.text) {
    if (!text) {
      applyTextareaEdit(el, el.value.slice(0, live.start) + el.value.slice(live.end), live.start);
      return;
    }
    el.setSelectionRange(live.start, live.end);
  } else if (!text) return;
  const start = el.selectionStart ?? el.value.length;
  const removed = (el.selectionEnd ?? start) - start;
  const before = el.value.length;
  insertAtCaret(el, text);
  if (final) return;
  const end = start + el.value.length - before + removed;
  dictationPreviews.set(el, { start, end, text: el.value.slice(start, end), run });
}

export function hasFiles(data: DataTransfer | null): data is DataTransfer {
  if (!data) return false;
  return (
    data.files.length > 0 ||
    [...data.types].some((type) => type === "Files" || type === "application/x-moz-file") ||
    Array.from(data.items ?? []).some((item) => item.kind === "file")
  );
}
