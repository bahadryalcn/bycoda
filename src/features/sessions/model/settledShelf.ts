import type { SessionSummary } from "../data/sessionStore";
import type { SessionListEntry } from "./sessionFolders";

const EXPANDED_KEY = "bycoda.settledSessionsExpanded";

/**
 * Moves loose settled sessions to a trailing Settled group. Reminders, folders and pins keep
 * their sessions: those are places the owner chose, settled or not.
 */
export function shelveSettledSessions(
  entries: readonly SessionListEntry[],
  isSettled: (session: SessionSummary) => boolean,
  collapsed: boolean,
): SessionListEntry[] {
  const settled: SessionSummary[] = [];
  const rest = entries.filter((entry) => {
    if (entry.kind !== "session" || !isSettled(entry.session)) return true;
    settled.push(entry.session);
    return false;
  });
  return settled.length ? [...rest, { kind: "settled", collapsed, sessions: settled }] : rest;
}

/** The shelf starts collapsed; opening it is remembered for every project. */
export function loadSettledSessionsCollapsed(): boolean {
  try {
    return localStorage.getItem(EXPANDED_KEY) !== "1";
  } catch {
    return true;
  }
}

export function saveSettledSessionsCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) localStorage.removeItem(EXPANDED_KEY);
    else localStorage.setItem(EXPANDED_KEY, "1");
  } catch {
    // private mode / quota
  }
}
