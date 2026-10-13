import {
  attachmentsDroppedByEdit,
  deleteTokenAtCaret,
  insertAtSelection,
  removeAttachmentFromText,
  tokensForIncoming,
  type TextSelection,
} from "./attachmentTokens";
import { mergeAttachments } from "./attachments";
import { withoutMissingAttachments } from "./queuePersistence";
import type { Attachment, QueuedMessage } from "./session";

/**
 * Editing a queued message happens on a copy of its text and attachments. These
 * are the steps of that copy; the token rules are the composer's own (see
 * attachmentTokens.ts), so a chip, its `[imageN]` token and the numbering stay
 * tied together the same way here.
 */

export type QueuedEditDraft = { text: string; attachments: Attachment[] };

export function queuedEditDraft(message: QueuedMessage): QueuedEditDraft {
  return { text: message.text, attachments: message.attachments };
}

/** Take the attachments at `indices` out; their tokens go and the rest renumber. */
function dropAt(
  text: string,
  files: Attachment[],
  indices: number[],
): { text: string; attachments: Attachment[] } {
  let next = text;
  let left = files;
  // Highest first, so an earlier removal never shifts an index still to come.
  for (const index of [...indices].sort((a, b) => b - a)) {
    next = removeAttachmentFromText(next, left, index);
    left = left.filter((_, i) => i !== index);
  }
  return { text: next, attachments: left };
}

/** A chip was removed. */
export function removeDraftAttachment(draft: QueuedEditDraft, id: string): QueuedEditDraft {
  const index = draft.attachments.findIndex((file) => file.id === id);
  return index < 0 ? draft : dropAt(draft.text, draft.attachments, [index]);
}

/**
 * The user typed: `text` replaces the draft text. An attachment whose token the
 * edit took out goes with it, and the caret follows the renumbering.
 */
export function editDraftText(
  draft: QueuedEditDraft,
  text: string,
  caret: number,
): { draft: QueuedEditDraft; caret: number } {
  const dropped = attachmentsDroppedByEdit(draft.text, text, draft.attachments);
  if (dropped.length === 0) {
    return { draft: { text, attachments: draft.attachments }, caret };
  }
  const result = dropAt(text, draft.attachments, dropped);
  return {
    draft: result,
    caret: dropAt(text.slice(0, caret), draft.attachments, dropped).text.length,
  };
}

/** Backspace / Delete against a token takes the whole token. Null otherwise. */
export function deleteDraftTokenAtCaret(
  draft: QueuedEditDraft,
  caret: number,
  direction: "back" | "forward",
): { draft: QueuedEditDraft; caret: number } | null {
  const edit = deleteTokenAtCaret(draft.text, caret, direction, draft.attachments);
  if (!edit) return null;
  return editDraftText(draft, edit.text, edit.caret);
}

/** New attachments join the end; their tokens go in at the caret. */
export function addDraftAttachments(
  draft: QueuedEditDraft,
  incoming: Attachment[],
  selection: TextSelection | null,
): { draft: QueuedEditDraft; caret: number } {
  const merged = mergeAttachments(draft.attachments, incoming);
  // Skipped duplicates are not in `merged`, so they get no token either.
  const tokens = tokensForIncoming(draft.attachments, merged.slice(draft.attachments.length));
  if (!tokens) {
    return {
      draft,
      caret: selection?.end ?? draft.text.length,
    };
  }
  const inserted = insertAtSelection(draft.text, selection, tokens);
  return {
    draft: { text: inserted.text, attachments: merged },
    caret: inserted.caret,
  };
}

/**
 * The queue row as it is after Save. Cards, intent and id are left as they
 * were; attachments that are gone are dropped with their tokens, as before.
 */
export function applyQueuedEdit(message: QueuedMessage, draft: QueuedEditDraft): QueuedMessage {
  return withoutMissingAttachments({ ...message, attachments: draft.attachments }, draft.text);
}

/** Nothing would be left to send: no words and no attachment that still exists. */
export function isQueuedEditEmpty(message: QueuedMessage, draft: QueuedEditDraft): boolean {
  const next = applyQueuedEdit(message, draft);
  return !next.text.trim() && next.attachments.length === 0;
}

/** True when saving would change the row. */
export function hasQueuedEditChanges(message: QueuedMessage, draft: QueuedEditDraft): boolean {
  return (
    draft.text !== message.text ||
    draft.attachments.length !== message.attachments.length ||
    draft.attachments.some((file, i) => file.id !== message.attachments[i]?.id)
  );
}
