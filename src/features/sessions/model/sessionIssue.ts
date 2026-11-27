import type { Block, Session } from "./session";
import { isProviderFailureText } from "./plan";

export const REMOVED_WORKTREE_ERROR = "Worktree unavailable";

export function isMissingPathError(text: string): boolean {
  return /\(os error [23]\)\s*$|\bENOENT\b|\bno such file or directory\b/i.test(text);
}

/** The recovery card takes the place of the latest checkout failure while a target is required. */
export function worktreeRecoveryErrorId(blocks: readonly Block[]): string | undefined {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.role === "user" && !block.draft && !block.internal) break;
    if (isSessionErrorBlock(block)) {
      if (block.text === REMOVED_WORKTREE_ERROR || isMissingPathError(block.text)) return block.id;
      break;
    }
  }
  return undefined;
}

export function normalizeWorktreeRecoveryError(blocks: Block[]): Block[] {
  const errorId = worktreeRecoveryErrorId(blocks);
  if (!errorId || blocks.find((block) => block.id === errorId)?.text === REMOVED_WORKTREE_ERROR)
    return blocks;
  return blocks.map((block) =>
    block.id === errorId ? { ...block, text: REMOVED_WORKTREE_ERROR } : block,
  );
}

/** Normalize only plain retry counters; preserve provider-specific error details. */
export function sessionRetryNotice(message: string | undefined): {
  reconnecting: boolean;
  detail: string | undefined;
} {
  const reconnect = message?.trim().match(/^Reconnecting(?:\.{3}|…)?\s*(\d+\/\d+)?\s*$/i);
  if (reconnect) return { reconnecting: true, detail: reconnect[1] };
  const retry = message?.trim().match(/^Retrying\s*\((\d+\/\d+)\)(?:\.{3}|…)?$/i);
  return { reconnecting: false, detail: retry?.[1] ?? message };
}

/** Older hosts saved writer rejection as untagged system text. Keep those
 * persisted failures visible and retryable without rewriting user history. */
export function isSessionErrorBlock(block: Block): boolean {
  return (
    block.role === "system" &&
    (block.notice === "error" ||
      (!block.notice &&
        !block.interjection &&
        !block.shell &&
        /^thread \S+ already has an active writer\s*$/i.test(block.text.trim())))
  );
}

// The block-derived part of `sessionIssue` rides on the immutable block array's
// identity, so tool events that leave the blocks alone do not rescan the turn.
const latestTurnScans = new WeakMap<Block[], { errored: boolean; reply: string | undefined }>();

function scanLatestTurn(blocks: Block[]): { errored: boolean; reply: string | undefined } {
  const cached = latestTurnScans.get(blocks);
  if (cached) return cached;
  let reply: string | undefined;
  let errored = false;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.role === "user" && !block.draft) break;
    if (isSessionErrorBlock(block)) {
      errored = true;
      break;
    }
    if (reply === undefined && block.role === "assistant" && block.text.trim()) reply = block.text;
  }
  const scan = { errored, reply };
  latestTurnScans.set(blocks, scan);
  return scan;
}

/** Only the latest submitted turn can require attention. */
export function sessionIssue(session: Session): "retrying" | "failed" | undefined {
  if ((session.busy || session.continuingElsewhere) && session.retryMessage) return "retrying";
  if (session.usageLimit) return "failed";
  const { errored, reply } = scanLatestTurn(session.blocks);
  if (errored) return "failed";
  if (!session.busy && !session.continuingElsewhere && isProviderFailureText(reply ?? ""))
    return "failed";
  return undefined;
}
