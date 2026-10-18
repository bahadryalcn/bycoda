import { type MutableRefObject, useCallback } from "react";
import {
  HARNESS_TITLE,
  sessionWorkCwd,
  type Session,
} from "../../../features/sessions/model/session";
import { type setSessions } from "../../../features/sessions/model/sessionsStore";
import {
  applyHarnessEvent,
  canCompactHarnessContext,
  canRewindHarnessLastTurn,
  compactHarnessContext,
  forgetHarnessSession,
  rewindHarnessLastTurn,
  type HarnessEvent,
} from "../../../integrations/harness";
import { type EditedResendCoordinator } from "../../../features/sessions/model/editLastTurn";
import { type orchestrator } from "../../../features/orchestration/model/orchestration";
import { remoteProjectFor } from "../../../features/connections/model/remoteProjects";
import { remoteSessionActions } from "../../../features/connections/model/remoteSessionActions";
import { syncDockBadge } from "../../../features/notifications/model/dockBadge";
import {
  sessionProviderAccountId,
  supportsProviderAccounts,
} from "../../../features/providers/model/providerAccounts";
import {
  buildConversationReplay,
  canRewindConversation,
  rewindConversationBeforeMessage,
} from "../../../features/sessions/model/conversationRewind";
import { conversationRewindStrategy } from "../../../features/sessions/model/conversationRewindStrategy";
import { shouldPersistSession, upsertSession } from "../../../features/sessions/data/sessionStore";
import { flushSync } from "react-dom";
import { notifyReviewChanged } from "../../../features/sessions/model/checkpoint";
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
  const onCompactContext = useCallback(
    (sessionId: string) => {
      const current = sessionsRef.current.find((session) => session.id === sessionId);
      if (current && remoteProjectFor(current.cwd))
        return remoteSessionActions(sessionId)?.compact() ?? false;
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
              { type: "status", text: "Compacting context…" },
            )
          : session,
      );
      sessionsRef.current = started;
      syncDockBadge(started);
      setSessions(started);

      void (async () => {
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
            onEvent: (event) => {
              if (turnGen.current.get(sessionId) !== gen) return;
              enqueueHarnessEvent(sessionId, event);
            },
          });
          if (turnGen.current.get(sessionId) !== gen) return;
          enqueueHarnessEvent(sessionId, {
            type: "status",
            text: "Compacted context",
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
    [enqueueHarnessEvent, flushHarnessEvents],
  );

  const onRewindMessage = useCallback(
    async (sessionId: string, blockId: string): Promise<boolean> => {
      if (
        windowTransferPendingRef.current ||
        movingSessionIds.current.has(sessionId) ||
        retiringTurns.current.has(sessionId) ||
        editedResends.isActive(sessionId)
      )
        return false;
      flushHarnessEvents();
      const snapshot = sessionsRef.current.find((session) => session.id === sessionId);
      if (
        !snapshot ||
        !canRewindConversation(snapshot, blockId) ||
        orchestrator.submissionError(sessionId)
      )
        return false;
      if (remoteProjectFor(snapshot.cwd)) {
        return (await remoteSessionActions(sessionId)?.rewind(blockId)) ?? false;
      }
      if (!editedResends.start(sessionId)) return false;
      const strategy = conversationRewindStrategy(
        snapshot,
        blockId,
        canRewindHarnessLastTurn(snapshot.harness),
      );
      let providerSessionId = snapshot.providerSessionId;
      try {
        if (strategy.preserveProviderBinding) {
          await rewindHarnessLastTurn({
            harness: snapshot.harness,
            sessionId,
            cwd: sessionWorkCwd(snapshot),
            model: snapshot.model,
            modelSettings: snapshot.modelSettings,
            providerAccountId: snapshot.providerAccountId,
            runtimeMode: snapshot.runtimeMode,
            providerTurnId: strategy.providerTurnId,
            onEvent: (event) => {
              if (event.type === "session.providerBound")
                providerSessionId = event.providerSessionId;
            },
          });
        } else {
          await forgetHarnessSession(snapshot.harness, sessionId);
        }
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
        const rewound = rewindConversationBeforeMessage(
          strategy.preserveProviderBinding ? { ...latest, providerSessionId } : latest,
          strategy.blockId,
          Date.now(),
          strategy,
        );
        if (rewound === latest) return false;
        if (shouldPersistSession(rewound)) await upsertSession(rewound);
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
        editedResends.finish(sessionId);
      }
    },
    [editedResends, flushHarnessEvents, persistSession],
  );
  return { onCompactContext, onRewindMessage };
}
