import { message } from "@tauri-apps/plugin-dialog";
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { type LinkedWorkItem, type Session } from "../../../features/sessions/model/session";
import {
  setSessionLinkedWorkItem,
  setSessionPinned,
  shouldPersistSession,
  upsertSession,
  type SessionSummary,
} from "../../../features/sessions/data/sessionStore";
import {
  mergeProjectHistorySummary,
  summaryFromSession,
} from "../../../features/sessions/data/sessionHistory";
import { appName } from "../../../shared/lib/appName";
import { t } from "../../../shared/i18n";
import { pathKey } from "../../../shared/lib/paths";
import type { useLinkedWorkItemPanelState } from "../bridges/useLinkedWorkItemPanels";
import type { useSessionLoading } from "./useSessionLoading";
import {
  flushHostSessionBindings,
  hostSessionBinding,
  patchHostSessionShellMetadata,
} from "../../../features/connections/model/sessionExecutionBinding";
import {
  pinState,
  resolvePinTarget,
  samePinTarget,
  type PinAttempt,
  type PinTarget,
} from "../../../features/sessions/data/sessionPinReceipts";
import {
  listPinSagas,
  preparePinSaga,
  resumePinSaga,
  type PinSaga,
} from "../../../features/sessions/model/sessionPinSaga";
import { NATIVE_SESSION_ORGANIZATION_ACTIVE } from "../../../features/sessions/model/sessionOrganizationStore";
import { isProjectPasswordLocked } from "../../../features/group-lock/model/groupLock";
import { withRoomPrivacyMutation } from "../../../features/group-lock/model/roomPrivacyProjection";
import { newRequestId } from "../../../shared/lib/id/requestId";

export interface HistorySessionMetaDeps {
  sessionsRef: MutableRefObject<Session[]>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  history: SessionSummary[];
  setHistory: Dispatch<SetStateAction<SessionSummary[]>>;
  setStoredLinkedSessions: Dispatch<SetStateAction<SessionSummary[]>>;
  loadedSessionCache: MutableRefObject<Map<string, Session>>;
  invalidateLoadedSession: ReturnType<typeof useSessionLoading>["invalidateLoadedSession"];
  setLinkedWorkItemPanels: ReturnType<
    typeof useLinkedWorkItemPanelState
  >["setLinkedWorkItemPanels"];
  refreshHistory: (cwd: string) => Promise<unknown>;
  sidebarCwd: string;
}

export function useHistorySessionMeta(deps: HistorySessionMetaDeps) {
  const {
    sessionsRef,
    setSessions,
    history,
    setHistory,
    setStoredLinkedSessions,
    loadedSessionCache,
    invalidateLoadedSession,
    setLinkedWorkItemPanels,
    refreshHistory,
    sidebarCwd,
  } = deps;

  const onPinHistorySession = useCallback(
    async (
      sessionId: string,
      pinned: boolean,
      captured?: { cwd: string; target: PinTarget | null },
    ): Promise<PinAttempt | void> => {
      const open = sessionsRef.current.find(
        (session) =>
          session.id === sessionId && (!captured || pathKey(session.cwd) === pathKey(captured.cwd)),
      );
      if (NATIVE_SESSION_ORGANIZATION_ACTIVE) {
        const cwd =
          captured?.cwd ?? open?.cwd ?? history.find((entry) => entry.id === sessionId)?.cwd;
        let sagaId: string | undefined;
        let confirmed: PinAttempt | undefined;
        try {
          if (!cwd) throw new Error("Session project is unavailable.");
          return await withRoomPrivacyMutation<PinAttempt>(async () => {
            if (isProjectPasswordLocked(cwd)) throw new Error("Project is locked.");
            if (captured && !captured.target)
              throw new Error("The original pin owner is unavailable; refresh this list.");
            const resolved = await resolvePinTarget(sessionId, cwd);
            if (captured?.target && !samePinTarget(captured.target, resolved))
              throw new Error("The pin owner changed; refresh this list.");
            const target = captured?.target ?? resolved;
            if (open && shouldPersistSession(open) && !(await upsertSession(open)))
              throw new Error(t("Could not save changes"));
            const state = await pinState(target);
            if (state.state !== "current" || state.pinned === null) {
              await message("The pin owner refused this change. Refresh the session list.", {
                title: appName(),
                kind: "error",
              });
              return { state: "refused", version: state.version, pinned: state.pinned };
            }
            sagaId = crypto.randomUUID();
            const saga: PinSaga = {
              id: sagaId,
              organizationId: crypto.randomUUID(),
              organization: null,
              state: "prepared",
              steps: [
                {
                  viewSessionId: sessionId,
                  viewCwd: cwd,
                  viewKind: "local",
                  target,
                  operationId: newRequestId(),
                  desiredPinned: pinned,
                  expectedVersion: state.version,
                  expectedAuthority: state.authority ?? null,
                  previousPinned: state.pinned,
                  state: "not-started",
                },
              ],
            };
            const prepared = await preparePinSaga(saga);
            if (prepared !== "applied") {
              await message(
                prepared === "unknown"
                  ? `Pin preparation outcome is unknown: ${sagaId}`
                  : "Pin change conflicted; refresh before retrying.",
                { title: appName(), kind: "error" },
              );
              return prepared === "unknown"
                ? { state: "unknown", operationId: sagaId }
                : { state: "refused", version: state.version, pinned: state.pinned };
            }
            const result = await resumePinSaga(sagaId);
            const receipt = result.saga.steps[0]?.receipt;
            confirmed = receipt;
            if (receipt?.state === "applied") {
              if (!samePinTarget(target, await resolvePinTarget(sessionId, cwd)))
                throw new Error("The displayed pin owner changed.");
              if (hostSessionBinding({ id: sessionId })) {
                patchHostSessionShellMetadata(sessionId, { pinned });
                await flushHostSessionBindings(sessionId);
              }
              setHistory((current) =>
                current.map((entry) =>
                  entry.id === sessionId &&
                  (!captured || pathKey(entry.cwd) === pathKey(captured.cwd))
                    ? { ...entry, pinned }
                    : entry,
                ),
              );
            }
            if (result.state !== "applied")
              await message(
                result.state === "unknown"
                  ? `Pin outcome is unknown: ${result.operationId ?? sagaId}`
                  : result.state === "applied-unavailable"
                    ? "Pin was applied, but refresh failed."
                    : "Pin change needs review in the sidebar.",
                { title: appName(), kind: "error" },
              );
            return receipt ?? { state: "unknown", operationId: sagaId };
          });
        } catch (error) {
          await message(
            confirmed?.state === "applied"
              ? `Pin was applied, but refresh failed: ${String(error)}`
              : String(error),
            { title: appName(), kind: "error" },
          );
          if (confirmed?.state === "applied") return confirmed;
          return sagaId
            ? { state: "unknown", operationId: sagaId }
            : { state: "refused", version: 0, pinned: null };
        }
      }
      try {
        if (open && shouldPersistSession(open)) {
          const saved = await upsertSession(open);
          if (!saved) throw new Error(t("Could not save changes"));
        }
        await setSessionPinned(sessionId, pinned);
      } catch (error) {
        await message(`${t("Could not save changes")}\n\n${String(error)}`, {
          title: appName(),
          kind: "error",
        });
        return;
      }
      setHistory((current) => {
        const existing = current.find(
          (entry) =>
            entry.id === sessionId && (!captured || pathKey(entry.cwd) === pathKey(captured.cwd)),
        );
        if (existing) {
          return mergeProjectHistorySummary(current, { ...existing, pinned });
        }
        if (!open) return current;
        return mergeProjectHistorySummary(current, {
          ...summaryFromSession(open),
          pinned,
        });
      });
    },
    [history, sessionsRef, setHistory],
  );

  const onSetHistorySessionLinkedWorkItem = useCallback(
    (sessionId: string, linkedWorkItem: LinkedWorkItem | undefined) => {
      const previousLinkedWorkItem =
        sessionsRef.current.find((session) => session.id === sessionId)?.linkedWorkItem ??
        history.find((session) => session.id === sessionId)?.linkedWorkItem;
      invalidateLoadedSession(sessionId);
      loadedSessionCache.current.delete(sessionId);

      const nextSessions = sessionsRef.current.map((session) =>
        session.id === sessionId ? { ...session, linkedWorkItem } : session,
      );
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);
      setHistory((current) =>
        current.map((session) =>
          session.id === sessionId ? { ...session, linkedWorkItem } : session,
        ),
      );
      setStoredLinkedSessions((current) =>
        linkedWorkItem
          ? current.map((session) =>
              session.id === sessionId ? { ...session, linkedWorkItem } : session,
            )
          : current.filter((session) => session.id !== sessionId),
      );
      setLinkedWorkItemPanels((current) => {
        if (!current.has(sessionId)) return current;
        const next = new Map(current);
        next.delete(sessionId);
        return next;
      });

      void setSessionLinkedWorkItem(sessionId, linkedWorkItem).catch((error) => {
        const rolledBackSessions = sessionsRef.current.map((session) =>
          session.id === sessionId && session.linkedWorkItem === linkedWorkItem
            ? { ...session, linkedWorkItem: previousLinkedWorkItem }
            : session,
        );
        sessionsRef.current = rolledBackSessions;
        setSessions(rolledBackSessions);
        setHistory((current) =>
          current.map((session) =>
            session.id === sessionId && session.linkedWorkItem === linkedWorkItem
              ? { ...session, linkedWorkItem: previousLinkedWorkItem }
              : session,
          ),
        );
        setStoredLinkedSessions((current) =>
          previousLinkedWorkItem
            ? current.map((session) =>
                session.id === sessionId
                  ? {
                      ...session,
                      linkedWorkItem: previousLinkedWorkItem,
                    }
                  : session,
              )
            : current.filter((session) => session.id !== sessionId),
        );
        void refreshHistory(sidebarCwd);
        void message(`Could not update this conversation's GitHub link.\n\n${String(error)}`, {
          title: appName(),
          kind: "error",
        });
      });
    },
    [history, invalidateLoadedSession, refreshHistory, sidebarCwd],
  );

  const onPinHistorySessions = useCallback(
    async (sessionIds: readonly string[], pinned: boolean) => {
      if (NATIVE_SESSION_ORGANIZATION_ACTIVE) {
        for (const sessionId of sessionIds) {
          const result = await onPinHistorySession(sessionId, pinned);
          if (!result || result.state !== "applied") break;
          if (
            (await listPinSagas()).some(
              (saga) => saga.state !== "applied" && saga.state !== "accepted",
            )
          )
            break;
        }
      } else
        await Promise.all(sessionIds.map((sessionId) => onPinHistorySession(sessionId, pinned)));
    },
    [onPinHistorySession],
  );

  const onConfirmedPin = useCallback(
    async (sessionId: string, cwd: string, pinned: boolean, target: PinTarget) => {
      if (!samePinTarget(target, await resolvePinTarget(sessionId, cwd)))
        throw new Error("Pin was applied on its original owner, but the displayed owner changed.");
      setHistory((current) =>
        current.map((entry) =>
          entry.id === sessionId && pathKey(entry.cwd) === pathKey(cwd)
            ? { ...entry, pinned }
            : entry,
        ),
      );
      if (hostSessionBinding({ id: sessionId })) {
        patchHostSessionShellMetadata(sessionId, { pinned });
        await flushHostSessionBindings(sessionId);
      }
    },
    [setHistory],
  );
  const onPreparePin = useCallback(
    async (sessionId: string, cwd: string) => {
      const open = sessionsRef.current.find(
        (session) => session.id === sessionId && pathKey(session.cwd) === pathKey(cwd),
      );
      if (open && shouldPersistSession(open) && !(await upsertSession(open)))
        throw new Error(t("Could not save changes"));
    },
    [sessionsRef],
  );

  return {
    onPinHistorySession,
    onPinHistorySessions,
    onConfirmedPin,
    onPreparePin,
    onSetHistorySessionLinkedWorkItem,
  };
}
