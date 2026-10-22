import { stripAttachmentTokens } from "./attachmentTokens";
import { isOperatorUserTurn, operatorUserPrompt } from "./operatorCommand";
import type { Session } from "./session";

/** The note the composer prepends when MCP servers are tagged (see `mcpContextText`). */
const MCP_CONTEXT =
  /^MCP context: Use the configured servers? .*? when relevant to this request\.\n\n/s;

/** What the user typed: no MCP context note, no tokens of attachments that are not restored. */
function typedText(
  text: string,
  attachments: Parameters<typeof stripAttachmentTokens>[1] = [],
): string {
  return stripAttachmentTokens(text.replace(MCP_CONTEXT, ""), attachments).trim();
}

/**
 * The user's own messages in this session, newest first, consecutive
 * duplicates collapsed. Queued messages are the newest: they have not reached
 * the transcript yet. Retained follow-up drafts were submitted by the user,
 * so they remain recallable even when delivery was stopped or unconfirmed.
 */
export function userPromptHistory(session: Pick<Session, "blocks" | "queuedMessages">): string[] {
  const entries: string[] = [];
  const push = (text: string) => {
    if (text && entries[entries.length - 1] !== text) entries.push(text);
  };
  for (const message of [...(session.queuedMessages ?? [])].reverse()) {
    push(typedText(message.text, message.attachments));
  }
  for (let index = session.blocks.length - 1; index >= 0; index -= 1) {
    const block = session.blocks[index];
    if (
      block.role !== "user" ||
      block.internal ||
      (block.draft && !block.followUpDelivery) ||
      block.secondOpinion ||
      block.ciContext
    ) {
      continue;
    }
    if (isOperatorUserTurn(block)) {
      const prompt = typedText(operatorUserPrompt(block), block.attachments);
      push(`/operator ${prompt}`.trim());
      continue;
    }
    push(typedText(block.text, block.attachments));
  }
  return entries;
}

/** Position in the history list (0 = newest) and the exact text it put in the composer. */
export type HistoryBrowse = { index: number; text: string };

export type HistoryKeyInput = {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  text: string;
  selectionStart: number;
  selectionEnd: number;
  /** No text, attachments or cards: the only state that starts browsing. */
  composerEmpty: boolean;
  /** A slash, mention or picker menu owns the arrow keys. */
  menuOpen: boolean;
  entries: readonly string[];
  browse: HistoryBrowse | null;
};

/**
 * What an arrow key does to the history. `text` is set when the composer
 * should take it (caret to the end) and the key is consumed; absent means the
 * key keeps its normal caret movement. `browse` is the state to keep either way.
 */
export type HistoryKeyResult = { browse: HistoryBrowse | null; text?: string };

export function historyKey(input: HistoryKeyInput): HistoryKeyResult {
  // Edited text is the user's own: browsing ends for good.
  const browse = input.browse && input.browse.text === input.text ? input.browse : null;
  const idle = { browse };
  if (input.key !== "ArrowUp" && input.key !== "ArrowDown") return idle;
  if (input.menuOpen) return idle;
  if (input.shiftKey || input.ctrlKey || input.altKey || input.metaKey) {
    return idle;
  }
  if (input.selectionStart !== input.selectionEnd) return idle;
  const caret = input.selectionStart;

  if (input.key === "ArrowUp") {
    if (!browse) {
      if (!input.composerEmpty || input.entries.length === 0) return idle;
      return recall(0, input.entries);
    }
    // Only from the first line; elsewhere the caret moves up.
    if (input.text.slice(0, caret).includes("\n")) return idle;
    if (browse.index + 1 >= input.entries.length) return idle;
    return recall(browse.index + 1, input.entries);
  }

  if (!browse) return idle;
  if (input.text.slice(caret).includes("\n")) return idle;
  if (browse.index === 0) return { browse: null, text: "" };
  return recall(browse.index - 1, input.entries);
}

function recall(index: number, entries: readonly string[]): HistoryKeyResult {
  const text = entries[index];
  return { browse: { index, text }, text };
}
