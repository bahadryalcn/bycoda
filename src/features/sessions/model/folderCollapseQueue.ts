import { setFolderCollapsed, type SessionFolder } from "./sessionFolders";

export type FolderCollapseChange = { folderId: string; collapsed: boolean };
/** "retry": another organization change is running, try again shortly. */
export type FolderCollapsePersistResult = "applied" | "retry" | "failed";

const RETRY_MS = 150;

/**
 * Opening or closing a folder is a view gesture: the sidebar shows it at once
 * and only the latest wanted state per folder is saved in the background.
 */
export function createFolderCollapseQueue(options: {
  persist: (changes: FolderCollapseChange[]) => Promise<FolderCollapsePersistResult>;
  onFailed: () => void;
}) {
  const pending = new Map<string, boolean>();
  const inFlight = new Map<string, boolean>();
  let running = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const flush = async (): Promise<void> => {
    if (running || !pending.size) return;
    running = true;
    const changes = [...pending].map(([folderId, collapsed]) => ({ folderId, collapsed }));
    pending.clear();
    for (const change of changes) inFlight.set(change.folderId, change.collapsed);
    let result: FolderCollapsePersistResult;
    try {
      result = await options.persist(changes);
    } catch {
      result = "failed";
    }
    for (const change of changes) {
      if (inFlight.get(change.folderId) === change.collapsed) inFlight.delete(change.folderId);
      // A newer click wins over a retried older one.
      if (result === "retry" && !pending.has(change.folderId))
        pending.set(change.folderId, change.collapsed);
    }
    running = false;
    if (result === "failed") {
      pending.clear();
      inFlight.clear();
      options.onFailed();
    } else if (result === "retry") {
      retryTimer = setTimeout(kick, RETRY_MS);
    } else {
      kick();
    }
  };

  function kick() {
    flush().catch(options.onFailed);
  }

  return {
    toggle(folderId: string, collapsed: boolean) {
      pending.set(folderId, collapsed);
      clearTimeout(retryTimer);
      kick();
    },
    /** Saved folders with the not-yet-saved clicks laid on top. */
    overlay(folders: SessionFolder[]): SessionFolder[] {
      let next = folders;
      for (const [folderId, collapsed] of inFlight)
        next = setFolderCollapsed(next, folderId, collapsed);
      for (const [folderId, collapsed] of pending)
        next = setFolderCollapsed(next, folderId, collapsed);
      return next;
    },
    dispose() {
      clearTimeout(retryTimer);
      pending.clear();
    },
  };
}
