import { useCallback, type MutableRefObject } from "react";
import type { setSessions } from "../../../features/sessions/model/sessionsStore";
import {
  formatSessionTitle,
  type Session,
} from "../../../features/sessions/model/session";
import {
  getSession,
  persistFingerprint,
  upsertSession,
} from "../../../features/sessions/data/sessionStore";
import { rememberLoadedSession } from "../../../features/sessions/data/sessionCache";

export interface SessionRenameDeps {
  sessionsRef: { current: Session[] };
  setSessions: typeof setSessions;
  loadedSessionCache: MutableRefObject<Map<string, Session>>;
  lastPersisted: MutableRefObject<Map<string, string>>;
  invalidateLoadedSession: (sessionId: string) => void;
  persistSession: (session: Session | undefined) => void;
  refreshHistory: (cwd: string) => Promise<void>;
  sidebarCwd: string;
}

/** Renames a conversation, whether it is open or only stored. */
export function useSessionRename({
  sessionsRef,
  setSessions,
  loadedSessionCache,
  lastPersisted,
  invalidateLoadedSession,
  persistSession,
  refreshHistory,
  sidebarCwd,
}: SessionRenameDeps) {
  const onRenameHistorySession = useCallback(
    async (sessionId: string, displayTitle: string) => {
      const trimmed = displayTitle.trim();
      if (!trimmed) return;
      invalidateLoadedSession(sessionId);

      const open = sessionsRef.current.find((session) => session.id === sessionId);
      if (open) {
        const title = formatSessionTitle(open.harness, trimmed);
        const updated = { ...open, title };
        setSessions((prev) =>
          prev.map((session) => (session.id === sessionId ? updated : session)),
        );
        loadedSessionCache.current.delete(sessionId);
        persistSession(updated);
      } else {
        const restored = await getSession(sessionId).catch(() => null);
        if (!restored) {
          void refreshHistory(sidebarCwd);
          return;
        }
        const updated = {
          ...restored,
          title: formatSessionTitle(restored.harness, trimmed),
        };
        const saved = await upsertSession(updated).catch(() => null);
        if (saved) {
          rememberLoadedSession(loadedSessionCache.current, updated);
          lastPersisted.current.set(sessionId, persistFingerprint(updated));
        }
      }
      void refreshHistory(sidebarCwd);
    },
    [invalidateLoadedSession, persistSession, refreshHistory, sidebarCwd],
  );

  return { onRenameHistorySession };
}
