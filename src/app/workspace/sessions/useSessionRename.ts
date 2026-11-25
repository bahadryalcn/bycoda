import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { hostSessionBinding } from "../../../features/connections/model/sessionExecutionBinding";
import type { setSessions } from "../../../features/sessions/model/sessionsStore";
import { formatSessionTitle, type Session } from "../../../features/sessions/model/session";
import {
  getSession,
  persistFingerprint,
  shouldPersistSession,
  upsertSession,
  updateOwnedSessionMetadata,
  type SessionSummary,
} from "../../../features/sessions/data/sessionStore";
import { rememberLoadedSession } from "../../../features/sessions/data/sessionCache";
import { t } from "../../../shared/i18n";
import { pathKey } from "../../../shared/lib/paths";
import { isProjectPasswordLocked } from "../../../features/group-lock/model/groupLock";

export interface SessionRenameDeps {
  sessionsRef: { current: Session[] };
  setSessions: typeof setSessions;
  setHistory?: Dispatch<SetStateAction<SessionSummary[]>>;
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
  setHistory,
  loadedSessionCache,
  lastPersisted,
  invalidateLoadedSession,
  refreshHistory,
  sidebarCwd,
}: SessionRenameDeps) {
  const onRenameHistorySession = useCallback(
    async (sessionId: string, displayTitle: string, expectedCwd?: string) => {
      const trimmed = displayTitle.trim();
      if (!trimmed) return;
      const assertOwner = (session: Session) => {
        if (
          expectedCwd &&
          (pathKey(session.cwd) !== pathKey(expectedCwd) || isProjectPasswordLocked(expectedCwd))
        )
          throw new Error(t("This project is no longer available."));
      };
      invalidateLoadedSession(sessionId);

      const open = sessionsRef.current.find((session) => session.id === sessionId);
      let persistedTitle: string;
      if (open) {
        assertOwner(open);
        const title = formatSessionTitle(open.harness, trimmed);
        const updated = { ...open, title };
        if (hostSessionBinding(updated)) {
          await updateOwnedSessionMetadata(sessionId, { title });
        } else if (shouldPersistSession(updated)) {
          const saved = await upsertSession(updated);
          if (!saved) throw new Error(t("Could not save changes"));
          lastPersisted.current.set(sessionId, persistFingerprint(updated));
        }
        setSessions((prev) =>
          prev.map((session) => (session.id === sessionId ? { ...session, title } : session)),
        );
        loadedSessionCache.current.delete(sessionId);
        persistedTitle = title;
      } else {
        const restored = await getSession(sessionId);
        if (!restored) throw new Error(t("Could not save changes"));
        assertOwner(restored);
        const updated = {
          ...restored,
          title: formatSessionTitle(restored.harness, trimmed),
        };
        const saved = hostSessionBinding(updated)
          ? await updateOwnedSessionMetadata(sessionId, { title: updated.title })
          : await upsertSession(updated);
        if (!saved) throw new Error(t("Could not save changes"));
        rememberLoadedSession(loadedSessionCache.current, updated);
        lastPersisted.current.set(sessionId, persistFingerprint(updated));
        persistedTitle = updated.title;
      }
      if (expectedCwd && pathKey(expectedCwd) !== pathKey(sidebarCwd)) {
        setHistory?.((rows) =>
          rows.map((row) =>
            row.id === sessionId && pathKey(row.cwd) === pathKey(expectedCwd)
              ? { ...row, title: persistedTitle }
              : row,
          ),
        );
      } else {
        void refreshHistory(sidebarCwd).catch(() => {});
      }
    },
    [
      invalidateLoadedSession,
      refreshHistory,
      sidebarCwd,
      sessionsRef,
      lastPersisted,
      setSessions,
      setHistory,
      loadedSessionCache,
    ],
  );

  return { onRenameHistorySession };
}
