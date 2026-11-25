import { captureDraft } from "../../../shared/lib/draftRestore";
import { MAX_EMBED_BYTES } from "./attachments";
import { PASTED_TEXT_FILENAME } from "./attachmentPresentation";
import { insertAtSelection, type TextSelection } from "./attachmentTokens";

const MIN_PASTED_TEXT_LENGTH = 8_000;

/** A stand-alone card needs no inline reference. Prose keeps the paste position. */
export function insertPastedTextReference(value: string, range: TextSelection, token: string) {
  const remaining = value.slice(0, range.start) + value.slice(range.end);
  return remaining.trim()
    ? insertAtSelection(value, range, token)
    : { text: remaining, caret: range.start };
}

/** Capture the insertion point without writing clipboard text into the draft. */
export function capturePastedTextAttachment(target: EventTarget | null, text: string) {
  if (text.length < MIN_PASTED_TEXT_LENGTH || text.length > MAX_EMBED_BYTES || !text.trim()) return;
  const captured = captureDraft(target);
  if (!captured) return;
  const file = new File([text], PASTED_TEXT_FILENAME, { type: "text/plain" });
  if (file.size > MAX_EMBED_BYTES) return;
  return {
    file,
    field: captured.field,
    range(value: string) {
      if (value === captured.value) return { start: captured.start, end: captured.end };
      // Another edit can change the captured selection while the file is being saved.
      const caret = value === captured.field.value ? captured.field.selectionEnd : null;
      return { start: caret ?? value.length, end: caret ?? value.length };
    },
  };
}
