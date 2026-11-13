import { useCallback, useRef } from "react";
import {
  regenerateSessionTitle,
  TitleRegenerationConflictError,
} from "../../../features/sessions/model/regenerateSessionTitle";
import {
  loadRemoteSession,
  remoteMachineFor,
  remoteSessionFor,
  refreshRemoteProjectSessions,
} from "../../../features/connections/model/connections";
import { parseRemotePath } from "../../../features/connections/model/remoteProjects";
import { getSession } from "../../../features/sessions/data/sessionStore";
import { resolveTitleGenerationChoice } from "../../../features/sessions/model/titlePreferences";
import { isProjectLocked } from "../../../features/group-lock/model/groupLock";
import { t } from "../../../shared/i18n";
import { pathKey } from "../../../shared/lib/paths";
import type { SessionRenameDeps } from "./useSessionRename";
import type { Session } from "../../../features/sessions/model/session";
import { newRequestId } from "../../../shared/lib/id/requestId";

/** Publish only a persisted title; keep concurrent transcript and execution state. */
export function useSessionTitleRegeneration({
  sessionsRef,
  setSessions,
  loadedSessionCache,
  lastPersisted,
  invalidateLoadedSession,
  refreshHistory,
  sidebarCwd,
}: SessionRenameDeps) {
  const requests = useRef(new Map<string, { key: string; commandId: string; session: Session }>());
  const pending = useRef(new Set<string>());
  const onRegenerateHistorySessionTitle = useCallback(
    async (sessionId: string, cwd = sidebarCwd) => {
      if (pending.current.has(sessionId)) return;
      pending.current.add(sessionId);
      try {
        const assertWritable = () => {
          if (isProjectLocked(cwd)) throw new Error(t("This project is no longer available."));
        };
        assertWritable();
        const open = sessionsRef.current.find((entry) => entry.id === sessionId);
        const remote = parseRemotePath(cwd);
        let session = open;
        if (!session && remote) {
          const machine = await remoteMachineFor(remote.environmentId);
          if (!machine) throw new Error(t("This project is no longer available."));
          const snapshot = await loadRemoteSession(
            machine.id,
            remoteSessionFor(sessionId) ?? sessionId,
          );
          session = { ...snapshot.session, cwd };
        }
        session ??= (await getSession(sessionId)) ?? undefined;
        if (!session) throw new Error(t("Could not save changes"));
        if (pathKey(session.cwd) !== pathKey(cwd))
          throw new Error(t("This project is no longer available."));
        const target = await resolveTitleGenerationChoice(session.harness, session.cwd);
        if (!target) throw new Error(t("Choose a title generation model in Settings."));
        const key = JSON.stringify([cwd, target]);
        let request = requests.current.get(sessionId);
        if (!request || request.key !== key) {
          request = { key, commandId: newRequestId(), session };
          requests.current.set(sessionId, request);
        }
        const originalTitle = request.session.title;
        const result = await regenerateSessionTitle(request.session, target, {
          commandId: request.commandId,
          assertWritable,
          currentSession: () => sessionsRef.current.find((entry) => entry.id === sessionId),
        });
        invalidateLoadedSession(sessionId);
        loadedSessionCache.current.delete(sessionId);
        lastPersisted.current.delete(sessionId);
        setSessions((previous) =>
          previous.map((entry) =>
            entry.id === sessionId && entry.title === originalTitle
              ? { ...entry, title: result.title }
              : entry,
          ),
        );
        refreshRemoteProjectSessions();
        await refreshHistory(cwd);
        requests.current.delete(sessionId);
      } catch (error) {
        if (error instanceof TitleRegenerationConflictError) requests.current.delete(sessionId);
        throw error;
      } finally {
        pending.current.delete(sessionId);
      }
    },
    [
      sessionsRef,
      setSessions,
      loadedSessionCache,
      lastPersisted,
      invalidateLoadedSession,
      refreshHistory,
      sidebarCwd,
    ],
  );
  return { onRegenerateHistorySessionTitle };
}
