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

export function hasFiles(data: DataTransfer | null): data is DataTransfer {
  if (!data) return false;
  return (
    data.files.length > 0 ||
    [...data.types].some((type) => type === "Files" || type === "application/x-moz-file") ||
    Array.from(data.items ?? []).some((item) => item.kind === "file")
  );
}
