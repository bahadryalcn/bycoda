import {
  markMissingAttachments,
  persistableQueue,
  restoreQueuedMessages,
  withoutMissingAttachments,
} from "./queuePersistence";
import type { McpTag } from "./mcpPicker";
import type { Attachment, QueuedMessage } from "./session";

/**
 * The unsent composer draft, as it is saved and brought back. Text, the MCP
 * tags chosen for it and its attachments are all that the composer keeps for
 * a session; the cards and the model belong to the session record itself.
 *
 * Attachments follow the queue's rules (queuePersistence.ts) because a draft
 * is a message that has not been queued yet: the draft is wrapped as a queued
 * message so the same functions decide what is kept, what is re-checked on
 * restore and what is dropped.
 */

export type ComposerDraft = {
  text: string;
  mcpTags: McpTag[];
  attachments: Attachment[];
};

/** What restoring a draft cost: the names of attachments that could not come back. */
export type RestoredDraft = { draft: ComposerDraft; dropped: string[] };

const DRAFT_ID = "draft";

function asMessage(draft: Pick<ComposerDraft, "text" | "attachments">): QueuedMessage {
  return { id: DRAFT_ID, text: draft.text, attachments: draft.attachments };
}

/** The draft as written to the store, or null when there is nothing worth keeping. */
export function persistableDraft(draft: ComposerDraft): ComposerDraft | null {
  if (!draft.text.trim() && draft.attachments.length === 0) return null;
  const [message] = persistableQueue([asMessage(draft)]) ?? [];
  if (!message) return null;
  return {
    text: message.text,
    attachments: message.attachments,
    mcpTags: draft.mcpTags,
  };
}

function restoreMcpTags(raw: unknown): McpTag[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((tag): tag is McpTag => {
    if (!tag || typeof tag !== "object") return false;
    const { token, server } = tag as Partial<McpTag>;
    if (typeof token !== "string" || !token) return false;
    if (!server || typeof server !== "object") return false;
    const { name, provider } = server as Partial<McpTag["server"]>;
    return typeof name === "string" && typeof provider === "string";
  });
}

/** Validate what the store returned. Anything that does not fit is dropped, never thrown. */
export function restoreDraft(raw: unknown): ComposerDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const [message] = restoreQueuedMessages([
    {
      id: DRAFT_ID,
      text: value.text,
      attachments: value.attachments,
    },
  ]);
  if (!message) return null;
  return {
    text: message.text,
    attachments: message.attachments,
    mcpTags: restoreMcpTags(value.mcpTags),
  };
}

/**
 * Re-check attachment files and drop the ones that are gone, with their
 * `[imageN]` tokens so the text does not point at nothing. The names come back
 * so the composer can say what was lost instead of losing it silently.
 */
export async function settleRestoredDraft(
  draft: ComposerDraft,
  existing: (paths: string[]) => Promise<Set<string>>,
): Promise<RestoredDraft | null> {
  const [checked] = await markMissingAttachments([asMessage(draft)], existing);
  const dropped = checked.attachments.filter((file) => file.missing).map((file) => file.name);
  const settled = withoutMissingAttachments(checked);
  const result = { ...draft, text: settled.text, attachments: settled.attachments };
  if (!result.text.trim() && result.attachments.length === 0) {
    return dropped.length > 0 ? { draft: result, dropped } : null;
  }
  return { draft: result, dropped };
}

/** The line shown when a restored draft lost attachments. */
export function droppedAttachmentsNotice(dropped: string[]): string {
  if (dropped.length === 0) return "";
  const shown = dropped.slice(0, 3).join(", ");
  const more = dropped.length > 3 ? ` and ${dropped.length - 3} more` : "";
  return dropped.length === 1
    ? `An attachment from your saved draft is no longer available and was removed: ${shown}.`
    : `${dropped.length} attachments from your saved draft are no longer available and were removed: ${shown}${more}.`;
}

/**
 * Whether a restored draft may be put in place. Text typed in this run always
 * wins: a draft is only restored into a slot that is still empty.
 */
export function canRestoreOver(current: { text?: string; attachments?: Attachment[] }): boolean {
  return !current.text && !(current.attachments?.length ?? 0);
}
