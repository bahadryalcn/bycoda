import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { type Attachment, type Session } from "../../../features/sessions/model/session";
import {
  canDispatchQueuedHead,
  dequeueQueuedMessage,
  queuedMessageForSubmit,
  reorderSessionQueue,
} from "../../../features/sessions/model/messageQueue";
import { applyQueuedEdit } from "../../../features/sessions/model/queuedMessageEdit";
import { CONTINUE_PROMPT } from "../../../features/sessions/model/inFlight";
import { sharedLocalQueueReady } from "../../../features/connections/model/useSharedLocalQueues";
import { type HarnessEvent } from "../../../integrations/harness";
import { type Submit } from "../helpers/types";

export interface QueuedMessageActionDeps {
  sessions: Session[];
  movingWindows: Set<string>;
  windowTransferPending: boolean;
  windowTransferPendingRef: MutableRefObject<boolean>;
  movingSessionIds: MutableRefObject<Set<string>>;
  retiringTurns: MutableRefObject<Map<string, number>>;
  sessionsRef: MutableRefObject<Session[]>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  onSubmit: Submit;
  enqueueHarnessEvent: (sessionId: string, event: HarnessEvent) => void;
  flushHarnessEvents: () => void;
}

/** Queued follow-up dispatch and queue edits. Queue ordering and dedup are copied verbatim. */
export function useQueuedMessageActions(deps: QueuedMessageActionDeps) {
  const {
    sessions,
    movingWindows,
    windowTransferPending,
    windowTransferPendingRef,
    movingSessionIds,
    retiringTurns,
    sessionsRef,
    setSessions,
    onSubmit,
    enqueueHarnessEvent,
    flushHarnessEvents,
  } = deps;
  const queueDispatchingRef = useRef(new Set<string>());

  useEffect(() => {
    const timers: number[] = [];
    const scheduled = new Set<string>();
    for (const session of sessions) {
      const queued = session.queuedMessages ?? [];
      if (
        windowTransferPending ||
        movingSessionIds.current.has(session.id) ||
        session.busy ||
        queued.length === 0
      )
        continue;

      if (session.queueStatus === "resuming") {
        setSessions((prev) =>
          prev.map((entry) =>
            entry.id === session.id ? { ...entry, queueStatus: "active" } : entry,
          ),
        );
        continue;
      }
      if (
        !canDispatchQueuedHead(session) ||
        !sharedLocalQueueReady(session.id) ||
        retiringTurns.current.has(session.id) ||
        queueDispatchingRef.current.has(session.id)
      ) {
        continue;
      }

      const next = queued[0];
      if (!next) continue;
      queueDispatchingRef.current.add(session.id);
      scheduled.add(session.id);
      timers.push(
        window.setTimeout(() => {
          queueDispatchingRef.current.delete(session.id);
          const latest = sessionsRef.current.find((entry) => entry.id === session.id);
          const head = latest?.queuedMessages?.[0];
          if (
            !latest ||
            !head ||
            head.id !== next.id ||
            windowTransferPendingRef.current ||
            movingSessionIds.current.has(session.id) ||
            retiringTurns.current.has(session.id) ||
            !canDispatchQueuedHead(latest)
          ) {
            return;
          }
          onSubmit(session.id, head.text, head.attachments, {
            queuedMessageId: head.id,
            noteCard: head.noteCard,
            handoffCard: head.handoffCard,
            intent: head.intent,
          });
        }, 0),
      );
    }
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      for (const id of scheduled) queueDispatchingRef.current.delete(id);
    };
  }, [onSubmit, sessions, movingWindows, windowTransferPending]);

  const onDeleteQueuedMessage = useCallback((sessionId: string, messageId: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId ? dequeueQueuedMessage(session, messageId) : session,
      ),
    );
  }, []);

  const onQueuedMessageEditingChange = useCallback((sessionId: string, messageId?: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId ? { ...session, editingQueuedMessageId: messageId } : session,
      ),
    );
  }, []);

  const onReorderQueuedMessages = useCallback((sessionId: string, messageIds: string[]) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId ? reorderSessionQueue(session, messageIds) : session,
      ),
    );
  }, []);

  const onEditQueuedMessage = useCallback(
    (sessionId: string, messageId: string, text: string, attachments: Attachment[]) => {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                queuedMessages: session.queuedMessages?.map((message) =>
                  message.id === messageId
                    ? applyQueuedEdit(message, { text, attachments })
                    : message,
                ),
                editingQueuedMessageId: undefined,
              }
            : session,
        ),
      );
    },
    [],
  );

  const onSteerQueuedMessage = useCallback(
    (sessionId: string, messageId: string) => {
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      const message = session ? queuedMessageForSubmit(session, messageId, "steer") : undefined;
      if (!session) return;
      if (!message) {
        if (
          session.queuedMessages?.some(
            (entry) =>
              entry.id === messageId &&
              entry.modelTarget &&
              !entry.attachments.some((file) => file.missing),
          )
        ) {
          enqueueHarnessEvent(sessionId, {
            type: "status",
            text: "This queued message uses a different model or effort. Resume the queue to send it as a new turn with its saved settings.",
          });
          flushHarnessEvents();
        }
        return;
      }
      if (message.intent === "orchestrate" && session.busy) {
        enqueueHarnessEvent(sessionId, {
          type: "status",
          text: "Orchestration planning will start after the current turn finishes.",
        });
        flushHarnessEvents();
        return;
      }
      onSubmit(sessionId, message.text, message.attachments, {
        followUpBehavior: "steer",
        queuedMessageId: message.id,
        noteCard: message.noteCard,
        handoffCard: message.handoffCard,
        intent: message.intent,
      });
    },
    [onSubmit, enqueueHarnessEvent, flushHarnessEvents],
  );

  const onResumeQueue = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      if (
        !session ||
        session.busy ||
        session.queueStatus !== "paused" ||
        !session.queuedMessages?.length
      ) {
        return;
      }
      setSessions((prev) =>
        prev.map((entry) =>
          entry.id === sessionId ? { ...entry, queueStatus: "resuming" } : entry,
        ),
      );
      onSubmit(sessionId, CONTINUE_PROMPT, [], {
        followUpBehavior: "steer",
      });
    },
    [onSubmit],
  );

  return {
    onDeleteQueuedMessage,
    onQueuedMessageEditingChange,
    onReorderQueuedMessages,
    onEditQueuedMessage,
    onSteerQueuedMessage,
    onResumeQueue,
  };
}
