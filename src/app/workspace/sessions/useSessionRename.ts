import { useCallback, type MutableRefObject } from "react";
import type { setSessions } from "../../../features/sessions/model/sessionsStore";
import { formatSessionTitle, type Session } from "../../../features/sessions/model/session";
import {
  getSession,
  persistFingerprint,
  shouldPersistSession,
  upsertSession,
} from "../../../features/sessions/data/sessionStore";
import { rememberLoadedSession } from "../../../features/sessions/data/sessionCache";
import { t } from "../../../shared/i18n";

export interface SessionRenameDeps {
  sessionsRef: { current: Session[] };
  setSessions: typeof setSessions;
  loadedSessionCache: MutableRefObject<Map<string, Session>>;
  lastPersisted: MutableRefObject<Map<string, string>>;
  invalidateLoadedSession: (sessionId: string) => void;
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
        if (shouldPersistSession(updated)) {
          const saved = await upsertSession(updated);
          if (!saved) throw new Error(t("Could not save changes"));
          lastPersisted.current.set(sessionId, persistFingerprint(updated));
        }
        setSessions((prev) =>
          prev.map((session) => (session.id === sessionId ? { ...session, title } : session)),
        );
        loadedSessionCache.current.delete(sessionId);
      } else {
        const restored = await getSession(sessionId);
        if (!restored) throw new Error(t("Could not save changes"));
        const updated = {
          ...restored,
          title: formatSessionTitle(restored.harness, trimmed),
        };
        const saved = await upsertSession(updated);
        if (!saved) throw new Error(t("Could not save changes"));
        rememberLoadedSession(loadedSessionCache.current, updated);
        lastPersisted.current.set(sessionId, persistFingerprint(updated));
      }
      void refreshHistory(sidebarCwd);
    },
    [invalidateLoadedSession, refreshHistory, sidebarCwd],
  );

  return { onRenameHistorySession };
}
