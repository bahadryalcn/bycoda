/** Longest message or structured preview a phone is shown in full; anything larger stays on the computer. */
export const REMOTE_APPROVAL_MESSAGE_MAX = 20_000;
export const REMOTE_APPROVAL_DETAILS_MAX = 65_536;

/** Native dialog titles (src-tauri) a phone may answer. Desktop action and secret dialogs are absent on
 * purpose; a new or renamed native title stays on the computer until it is reviewed and listed here. */
const REMOTE_APPROVAL_TITLES = new Set([
  "bycoda — Application operation approval",
  "bycoda — Task operation approval",
  "bycoda — Inbox operation approval",
  "bycoda — Jira read approval",
  "bycoda — Room delegation",
  "bycoda — Delegated operation",
  "bycoda — Rebuild Room privacy",
]);

/**
 * Whether the paired phone may answer this approval. Secret entry and desktop input, launch and clipboard
 * operations need the owner at the computer. Native sends the same `owner.approval` action for every
 * confirmation, so only reviewed dialog titles qualify; anything else, or anything too large to show in
 * full, stays on the computer.
 */
export function isRemoteApproval(input: {
  action?: unknown;
  title: string;
  message: string;
  details?: unknown;
}): boolean {
  if (input.action !== undefined && input.action !== "owner.approval") return false;
  if (!REMOTE_APPROVAL_TITLES.has(input.title)) return false;
  if (input.message.length > REMOTE_APPROVAL_MESSAGE_MAX) return false;
  return JSON.stringify(input.details ?? null).length <= REMOTE_APPROVAL_DETAILS_MAX;
}
