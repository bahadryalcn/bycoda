import { useEffect, type Dispatch, type SetStateAction } from "react";
import { prefetchProjectFiles } from "../../../features/files/model/fileIndex";
import {
  listLinkedSessions,
  type SessionSummary,
} from "../../../features/sessions/data/sessionStore";

export interface HistorySyncDeps {
  inboxViewOpen: boolean;
  gitCwd: string;
  setStoredLinkedSessions: Dispatch<SetStateAction<SessionSummary[]>>;
}

/** Linked-session list load while the inbox is open, and the git-cwd file index prefetch. */
export function useHistorySync({
  inboxViewOpen,
  gitCwd,
  setStoredLinkedSessions,
}: HistorySyncDeps): void {
  useEffect(() => {
    if (!inboxViewOpen) return;
    let cancelled = false;
    void listLinkedSessions()
      .then((rows) => {
        if (!cancelled) setStoredLinkedSessions(rows);
      })
      .catch(() => {
        // Already-loaded and live sessions still provide a useful fallback.
      });
    return () => {
      cancelled = true;
    };
  }, [inboxViewOpen]);

  useEffect(() => {
    prefetchProjectFiles(gitCwd);
  }, [gitCwd]);
}
