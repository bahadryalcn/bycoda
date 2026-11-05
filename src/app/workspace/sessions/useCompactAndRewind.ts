import { hostSessionBinding } from "../../../features/connections/model/sessionExecutionBinding";
import { compactionContextEvents } from "../../../integrations/harness/core/compactionContext";
import { type MutableRefObject, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../../../shared/i18n";
import {
  HARNESS_TITLE,
  sessionWorkCwd,
  type Session,
} from "../../../features/sessions/model/session";
import { type setSessions } from "../../../features/sessions/model/sessionsStore";
import {
  COMPACTED_TEXT,
  COMPACTING_TEXT,
  COMPACTION_STATUS_KEY,
} from "../../../features/sessions/model/compactionStatus";
import {
  applyHarnessEvent,
  canCompactHarnessContext,
  compactHarnessContext,
  forgetHarnessSession,
  stopHarnessSession,
  type HarnessEvent,
} from "../../../integrations/harness";
import { type EditedResendCoordinator } from "../../../features/sessions/model/editLastTurn";
import { type orchestrator } from "../../../features/orchestration/model/orchestration";
import { remoteProjectFor } from "../../../features/connections/model/remoteProjects";
import { remoteSessionActions } from "../../../features/connections/model/remoteSessionActions";
import { syncDockBadge } from "../../../features/notifications/model/dockBadge";
import { operatorEnabledInThread } from "../../../features/sessions/model/operatorCommand";
import {
  sessionProviderAccountId,
  supportsProviderAccounts,
} from "../../../features/providers/model/providerAccounts";
import {
  buildConversationReplay,
  canRewindConversation,
  rewindConversationBeforeMessage,
} from "../../../features/sessions/model/conversationRewind";
import { shouldPersistSession, upsertSession } from "../../../features/sessions/data/sessionStore";
import { flushSync } from "react-dom";
import { notifyReviewChanged } from "../../../features/sessions/model/checkpoint";
import {
  applyWorkspaceRewind,
  planWorkspaceRewind,
} from "../../../features/workspaces/model/rewindClient";
import {
  clearWorkspaceRewindUndo,
  requestWorkspaceRewindPreview,
  registerWorkspaceRewindUndoHandler,
  type WorkspaceRewindUndoIdentity,
} from "../../../features/workspaces/ui/WorkspaceRewindPreview";
export interface CompactAndRewindDeps {
  sessionsRef: MutableRefObject<Session[]>;
  setSessions: typeof setSessions;
  turnGen: MutableRefObject<Map<string, number>>;
  enqueueHarnessEvent: (sessionId: string, event: HarnessEvent) => void;
  flushHarnessEvents: () => void;
  retiringTurns: MutableRefObject<Map<string, number>>;
  editedResends: EditedResendCoordinator;
  windowTransferPendingRef: MutableRefObject<boolean>;
  movingSessionIds: MutableRefObject<Set<string>>;
  orchestrator: typeof orchestrator;
  lastBoundProvider: MutableRefObject<Map<string, string>>;
  lastPersistedUserBlock: MutableRefObject<Map<string, string>>;
  persistSession: (session: Session | undefined) => void;
}

/** Why a rewind from this message is refused, in words for the person. */
function rewindRefusalReason(session: Session | undefined, submissionError: string | null): string {
  if (!session) return "This conversation is no longer open, so it cannot be rewound.";
  if (submissionError) return submissionError;
  if (session.busy) return "Stop the running turn before rewinding the conversation.";
  if (session.pendingQuestion || session.blocks.some((b) => b.approval && !b.approval.decided))
    return "Answer the open question or approval before rewinding the conversation.";
  if ((session.queuedMessages?.length ?? 0) > 0 || session.editingQueuedMessageId)
    return "Send or delete the queued messages before rewinding the conversation.";
  if (session.historyLoading || session.historyPartial || session.worktreePreparing)
    return "The conversation is still loading. Rewind it once it has loaded.";
  if (session.worktreeRemoved)
    return "This conversation's workspace was removed, so it cannot be rewound.";
  if (session.continuingElsewhere || session.adoptedSyncConflict)
    return "The bycoda Host owns this conversation right now. Wait for it to finish before rewinding.";
  if (session.orchestrationLeadId || session.automationId)
    return "This conversation belongs to an orchestration or automation and cannot be rewound.";
  return "This message cannot be rewound from here.";
}

/** Manual context compaction and conversation rewind for a session. */
export function useCompactAndRewind({
  sessionsRef,
  setSessions,
  turnGen,
  enqueueHarnessEvent,
  flushHarnessEvents,
  retiringTurns,
  editedResends,
  windowTransferPendingRef,
  movingSessionIds,
  orchestrator,
  lastBoundProvider,
  lastPersistedUserBlock,
  persistSession,
}: CompactAndRewindDeps) {
  const say = useCallback(
    (sessionId: string, text: string) => {
      enqueueHarnessEvent(sessionId, { type: "status", text });
      flushHarnessEvents();
    },
    [enqueueHarnessEvent, flushHarnessEvents],
  );
  const onCompactContext = useCallback(
    (sessionId: string) => {
      const current = sessionsRef.current.find((session) => session.id === sessionId);
      if (current && (hostSessionBinding(current) || remoteProjectFor(current.cwd))) {
        if (remoteSessionActions(sessionId)?.compact()) return true;
        say(
          sessionId,
          "Compaction did not start. The bycoda Host conversation must be connected, idle and without pending changes. Try /compact again once it is.",
        );
        return false;
      }
      if (current?.busy && !current.worktreeRemoved) {
        // Keep the typed command and say why, instead of ignoring it silently.
        const waiting = sessionsRef.current.map((session) =>
          session.id === sessionId
            ? applyHarnessEvent(session, {
                type: "status",
                text: "Compaction runs between turns. Wait for this turn to finish or stop it, then send /compact again.",
              })
            : session,
        );
        sessionsRef.current = waiting;
        setSessions(waiting);
        return false;
      }
      if (!current || current.worktreeRemoved) return false;
      if (!canCompactHarnessContext(current.harness)) {
        const unsupported = sessionsRef.current.map((session) =>
          session.id === sessionId
            ? applyHarnessEvent(session, {
                type: "status",
                text: `${HARNESS_TITLE[current.harness]} does not support manual context compaction.`,
              })
            : session,
        );
        sessionsRef.current = unsupported;
        syncDockBadge(unsupported);
        setSessions(unsupported);
        return true;
      }

      const gen = (turnGen.current.get(sessionId) ?? 0) + 1;
      turnGen.current.set(sessionId, gen);
      const workCwd = sessionWorkCwd(current);
      const started = sessionsRef.current.map((session) =>
        session.id === sessionId
          ? applyHarnessEvent(
              { ...session, busy: true },
              {
                type: "status",
                key: COMPACTION_STATUS_KEY,
                running: true,
                text: COMPACTING_TEXT,
              },
            )
          : session,
      );
      sessionsRef.current = started;
      syncDockBadge(started);
      setSessions(started);
      const operatorAccess = operatorEnabledInThread(current.blocks);
      const controlsAgents = operatorAccess || orchestrator.run(sessionId)?.status === "active";

      void (async () => {
        const contextEvents = compactionContextEvents((event) =>
          enqueueHarnessEvent(sessionId, event),
        );
        try {
          await compactHarnessContext({
            harness: current.harness,
            sessionId,
            cwd: workCwd,
            model: current.model,
            modelSettings: current.modelSettings,
            providerAccountId: supportsProviderAccounts(current.harness)
              ? sessionProviderAccountId(current.harness, current)
              : undefined,
            runtimeMode: current.runtimeMode,
            controlsAgents,
            appAccess: operatorAccess,
            onEvent: (event) => {
              if (turnGen.current.get(sessionId) !== gen) return;
              contextEvents.onEvent(event);
            },
          });
          if (turnGen.current.get(sessionId) !== gen) return;
          contextEvents.complete();
          enqueueHarnessEvent(sessionId, {
            type: "status",
            key: COMPACTION_STATUS_KEY,
            running: false,
            text: COMPACTED_TEXT,
          });
        } catch (error: unknown) {
          if (turnGen.current.get(sessionId) !== gen) return;
          enqueueHarnessEvent(sessionId, {
            type: "session.error",
            message:
              error instanceof Error
                ? error.message
                : `${current.harness} could not compact this context`,
          });
        } finally {
          if (turnGen.current.get(sessionId) === gen) {
            flushHarnessEvents();
            const finished = sessionsRef.current.map((session) =>
              session.id === sessionId ? { ...session, busy: false } : session,
            );
            sessionsRef.current = finished;
            syncDockBadge(finished);
            setSessions(finished);
          }
        }
      })();
      return true;
    },
    [enqueueHarnessEvent, flushHarnessEvents, say],
  );

  const reconcileManaged = useCallback((sessionId: string, next: Session) => {
    turnGen.current.set(sessionId, (turnGen.current.get(sessionId) ?? 0) + 1);
    lastBoundProvider.current.delete(sessionId);
    lastPersistedUserBlock.current.delete(sessionId);
    sessionsRef.current = sessionsRef.current.map((session) =>
      session.id === sessionId ? next : session,
    );
    flushSync(() =>
      setSessions((prev) => prev.map((session) => (session.id === sessionId ? next : session))),
    );
    notifyReviewChanged(sessionId);
  }, []);
  const undoManaged = useCallback(
    async (sessionId: string, { workspaceId, operationId }: WorkspaceRewindUndoIdentity) => {
      const current = sessionsRef.current.find((session) => session.id === sessionId);
      if (
        !current ||
        current.workspaceId !== workspaceId ||
        hostSessionBinding(current) ||
        remoteProjectFor(current.cwd) ||
        current.busy ||
        windowTransferPendingRef.current ||
        movingSessionIds.current.has(sessionId) ||
        retiringTurns.current.has(sessionId)
      )
        throw new Error(t("Wait for this session to finish before undoing the rewind."));
      const editToken = editedResends.start(sessionId);
      if (!editToken)
        throw new Error(t("Wait for this session to finish before undoing the rewind."));
      const authorityGeneration = current.adoptedAuthorityGeneration;
      try {
        await stopHarnessSession(current.harness, sessionId);
        const undoPlan = await planWorkspaceRewind(
          current,
          workspaceId,
          { operationId },
          { authorityGeneration },
        );
        const undoKey = crypto.randomUUID();
        await requestWorkspaceRewindPreview(
          undoPlan,
          async () => {
            const latest = sessionsRef.current.find((session) => session.id === sessionId);
            if (
              !latest ||
              latest.blocks !== current.blocks ||
              latest.busy ||
              latest.adoptedAuthorityGeneration !== authorityGeneration
            )
              throw new Error(t("The conversation changed. Close this preview and try again."));
            const undone = await applyWorkspaceRewind(latest, undoPlan, undoKey, {
              authorityGeneration,
            });
            await forgetHarnessSession(current.harness, sessionId);
            reconcileManaged(sessionId, undone.session);
            clearWorkspaceRewindUndo(sessionId);
          },
          sessionId,
        );
      } finally {
        editedResends.finish(sessionId, editToken);
      }
    },
    [editedResends, reconcileManaged],
  );
  useEffect(() => registerWorkspaceRewindUndoHandler("*", undoManaged), [undoManaged]);

  const onRewindMessage = useCallback(
    async (sessionId: string, blockId: string): Promise<boolean> => {
      if (
        windowTransferPendingRef.current ||
        movingSessionIds.current.has(sessionId) ||
        retiringTurns.current.has(sessionId) ||
        editedResends.isActive(sessionId)
      ) {
        enqueueHarnessEvent(sessionId, {
          type: "status",
          text: "Another change to this conversation is still finishing. Try again in a moment.",
        });
        flushHarnessEvents();
        return false;
      }
      flushHarnessEvents();
      const snapshot = sessionsRef.current.find((session) => session.id === sessionId);
      const submissionError = snapshot ? orchestrator.submissionError(sessionId) : null;
      if (!snapshot || !canRewindConversation(snapshot, blockId) || submissionError) {
        say(sessionId, rewindRefusalReason(snapshot, submissionError));
        return false;
      }
      if (hostSessionBinding(snapshot) || remoteProjectFor(snapshot.cwd)) {
        if (await remoteSessionActions(sessionId)?.rewind(blockId)) return true;
        say(
          sessionId,
          "The bycoda Host did not rewind this conversation. Check the connection and that no turn is running, then try again.",
        );
        return false;
      }
      const editToken = editedResends.start(sessionId);
      if (!editToken) {
        say(
          sessionId,
          "Another change to this conversation is still finishing. Try again in a moment.",
        );
        return false;
      }
      try {
        // Edit from here has an exact message boundary. A provider turn may
        // contain several user steers, and provider rewind can also touch files.
        // Reopen retained context instead of invoking provider/Git restoration.
        await forgetHarnessSession(snapshot.harness, sessionId);
        const latest = sessionsRef.current.find((session) => session.id === sessionId);
        if (
          !latest ||
          latest.blocks !== snapshot.blocks ||
          latest.harness !== snapshot.harness ||
          latest.model !== snapshot.model ||
          latest.cwd !== snapshot.cwd ||
          !canRewindConversation(latest, blockId)
        ) {
          throw new Error("The conversation changed while returning to the message. Try again.");
        }
        const rewound = rewindConversationBeforeMessage(latest, blockId);
        if (rewound === latest) return false;
        if (shouldPersistSession(rewound)) await upsertSession(rewound);
        if (sessionsRef.current.find((session) => session.id === sessionId) !== latest) {
          throw new Error("The conversation changed while returning to the message. Try again.");
        }
        turnGen.current.set(sessionId, (turnGen.current.get(sessionId) ?? 0) + 1);
        lastBoundProvider.current.delete(sessionId);
        lastPersistedUserBlock.current.delete(sessionId);
        sessionsRef.current = sessionsRef.current.map((session) =>
          session.id === sessionId ? rewound : session,
        );
        flushSync(() =>
          setSessions((prev) =>
            prev.map((session) => (session.id === sessionId ? rewound : session)),
          ),
        );
        persistSession(rewound);
        // Retire removed message history only after the replacement transcript
        // is durable. A cleanup failure must not undo the successful chat edit.
        await invoke("session_files_forget_from_message", {
          sessionId,
          userBlockId: blockId,
        }).catch((error) => console.warn("File history retirement failed", error));
        notifyReviewChanged(sessionId);
        return true;
      } catch (error) {
        // A failed native rewind or a competing state change may have changed the
        // provider already. Keep the visible history and reopen it from that history.
        await forgetHarnessSession(snapshot.harness, sessionId);
        const latest = sessionsRef.current.find((session) => session.id === sessionId);
        if (latest && latest.harness === snapshot.harness && !latest.busy) {
          const recovered = {
            ...latest,
            providerSessionId: undefined,
            pendingContextReplay: buildConversationReplay(latest.blocks) || undefined,
            context: undefined,
          };
          sessionsRef.current = sessionsRef.current.map((session) =>
            session.id === sessionId ? recovered : session,
          );
          setSessions((prev) =>
            prev.map((session) => (session.id === sessionId ? recovered : session)),
          );
          persistSession(recovered);
        }
        throw error;
      } finally {
        editedResends.finish(sessionId, editToken);
      }
    },
    [editedResends, enqueueHarnessEvent, flushHarnessEvents, persistSession, say],
  );
  return { onCompactContext, onRewindMessage };
}
