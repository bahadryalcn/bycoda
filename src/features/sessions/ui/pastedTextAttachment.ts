import { captureDraft, insertRestoredText } from "../../../shared/lib/draftRestore";
import { MAX_EMBED_BYTES } from "../model/attachments";
import { PASTED_TEXT_FILENAME } from "../model/attachmentPresentation";
import { insertAtSelection, type TextSelection } from "../model/attachmentTokens";

const MIN_PASTED_TEXT_LENGTH = 8_000;

/** A stand-alone card needs no inline reference. Prose keeps the paste position. */
export function replacePastedText(value: string, range: TextSelection, token: string) {
  const remaining = value.slice(0, range.start) + value.slice(range.end);
  return remaining.trim()
    ? insertAtSelection(value, range, token)
    : { text: remaining, caret: range.start };
}

/** Keep the original paste in the draft until its file has a durable path. */
export function capturePastedTextAttachment(target: EventTarget | null, text: string) {
  if (text.length < MIN_PASTED_TEXT_LENGTH || text.length > MAX_EMBED_BYTES || !text.trim()) return;
  const captured = captureDraft(target);
  if (!captured) return;
  const file = new File([text], PASTED_TEXT_FILENAME, { type: "text/plain" });
  if (file.size > MAX_EMBED_BYTES) return;
  const draftText = text.replace(/\r\n?/g, "\n");
  const alreadyPresent = captured.value.includes(draftText);
  return {
    file,
    text: draftText,
    field: captured.field,
    insert: () => insertRestoredText(captured, draftText),
    range(value: string) {
      // A prior paste may shorten the draft before this one. Follow a uniquely
      // identifiable paste, while leaving edited or ambiguous text intact.
      const atOriginalPosition = value.startsWith(draftText, captured.start);
      const start = atOriginalPosition
        ? captured.start
        : alreadyPresent
          ? -1
          : value.indexOf(draftText);
      if (start < 0 || (!atOriginalPosition && start !== value.lastIndexOf(draftText))) return;
      return { start, end: start + draftText.length };
    },
  };
}
