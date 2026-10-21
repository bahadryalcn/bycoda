import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { type Attachment, type Session } from "../../../features/sessions/model/session";
import {
  canDispatchQueuedHead,
  dequeueQueuedMessage,
  queuedMessageForSubmit,
  reorderSessionQueue,
} from "../../../features/sessions/model/messageQueue";
import { applyQueuedEdit } from "../../../features/sessions/model/queuedMessageEdit";
import { CONTINUE_PROMPT } from "../../../features/sessions/model/inFlight";
import {
  sharedLocalQueueReady,
  resumeSharedLocalQueue,
} from "../../../features/connections/model/useSharedLocalQueues";
import { hasMissingAttachment } from "../../../features/sessions/model/queuePersistence";
import type { QueueActionResult } from "../../../features/sessions/model/queueAction";
import {
  clearDeliveryProgress,
  readDeliveryProgress,
} from "../../../features/sessions/model/deliveryProgress";
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
  const manualActions = useRef(new Set<string>());

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
        if (manualActions.current.has(session.id)) continue;
        setSessions((prev) =>
          prev.map((entry) =>
            entry.id === session.id ? { ...entry, queueStatus: "paused" } : entry,
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
          void Promise.resolve(
            onSubmit(session.id, head.text, head.attachments, {
              queuedMessageId: head.id,
              noteCard: head.noteCard,
              handoffCard: head.handoffCard,
              intent: head.intent,
            }),
          ).catch((error) => {
            setSessions((sessions) =>
              sessions.map((entry) =>
                entry.id === session.id ? { ...entry, queueStatus: "paused" } : entry,
              ),
            );
            enqueueHarnessEvent(session.id, {
              type: "status",
              text: String(error).replace(/^Error: /, ""),
            });
            flushHarnessEvents();
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
    const progress = readDeliveryProgress(sessionId, messageId);
    if (progress && !["accepted", "rejected", "unknown"].includes(progress.stage)) return;
    if (progress) clearDeliveryProgress(sessionId, progress);
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
      const progress = readDeliveryProgress(sessionId, messageId);
      if (progress && !["accepted", "rejected", "unknown"].includes(progress.stage)) return;
      if (progress) clearDeliveryProgress(sessionId, progress);
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
    async (sessionId: string, messageId: string): Promise<QueueActionResult> => {
      if (manualActions.current.has(sessionId)) return false;
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      const message = session ? queuedMessageForSubmit(session, messageId, "steer") : undefined;
      if (!session) return false;
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
        throw new Error(
          "This message cannot be sent now. Check its attachments and saved model settings, or resume the queue.",
        );
      }
      if (message.intent === "orchestrate" && session.busy) {
        enqueueHarnessEvent(sessionId, {
          type: "status",
          text: "Orchestration planning will start after the current turn finishes.",
        });
        flushHarnessEvents();
        return false;
      }
      manualActions.current.add(sessionId);
      try {
        return await onSubmit(sessionId, message.text, message.attachments, {
          followUpBehavior: "steer",
          queuedMessageId: message.id,
          noteCard: message.noteCard,
          handoffCard: message.handoffCard,
          intent: message.intent,
        });
      } finally {
        manualActions.current.delete(sessionId);
      }
    },
    [onSubmit, enqueueHarnessEvent, flushHarnessEvents],
  );

  const onResumeQueue = useCallback(
    async (sessionId: string): Promise<QueueActionResult> => {
      if (manualActions.current.has(sessionId)) return false;
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      if (!session || !session.queuedMessages?.length) {
        return false;
      }
      if (session.queuedMessages.some((message) => message.deliveryUnknown))
        throw new Error("Review the unconfirmed delivery before resuming this queue.");
      if (
        windowTransferPendingRef.current ||
        movingSessionIds.current.has(sessionId) ||
        retiringTurns.current.has(sessionId) ||
        session.historyLoading
      )
        throw new Error("This conversation is still preparing. Wait and try again.");
      if (session.usageLimit)
        throw new Error(
          "The usage limit is holding this queue. Resolve the limit before resuming.",
        );
      if (session.editingQueuedMessageId)
        throw new Error("Finish editing the queued message before resuming.");
      const head = session.queuedMessages[0];
      if (hasMissingAttachment(head))
        throw new Error("An attachment is missing. Edit the queued message before resuming.");
      manualActions.current.add(sessionId);
      try {
        if (session.busy) {
          setSessions((prev) =>
            prev.map((entry) =>
              entry.id === sessionId ? { ...entry, queueStatus: "resuming" } : entry,
            ),
          );
          await resumeSharedLocalQueue(
            sessionId,
            () =>
              sessionsRef.current.find((entry) => entry.id === sessionId)?.queueStatus ===
              "resuming",
          );
          setSessions((prev) =>
            prev.map((entry) =>
              entry.id === sessionId && entry.queueStatus === "resuming"
                ? { ...entry, queueStatus: "active" }
                : entry,
            ),
          );
          return {
            kind: "waiting",
            message: "Queue resumed. Messages will send when this turn finishes.",
          };
        }
        if (session.queueStatus === "restored") {
          return await onSubmit(sessionId, head.text, head.attachments, {
            followUpBehavior: "steer",
            queuedMessageId: head.id,
            noteCard: head.noteCard,
            handoffCard: head.handoffCard,
            intent: head.intent,
          });
        }
        setSessions((prev) =>
          prev.map((entry) =>
            entry.id === sessionId ? { ...entry, queueStatus: "resuming" } : entry,
          ),
        );
        const accepted = await onSubmit(sessionId, CONTINUE_PROMPT, [], {
          followUpBehavior: "steer",
        });
        if (!accepted)
          throw new Error("The interrupted turn could not be resumed. The queue is still paused.");
        const latest = sessionsRef.current.find((entry) => entry.id === sessionId);
        if (latest?.queueStatus !== "resuming") return false;
        await resumeSharedLocalQueue(
          sessionId,
          () =>
            sessionsRef.current.find((entry) => entry.id === sessionId)?.queueStatus === "resuming",
        );
        setSessions((prev) =>
          prev.map((entry) =>
            entry.id === sessionId && entry.queueStatus === "resuming"
              ? { ...entry, queueStatus: "active" }
              : entry,
          ),
        );
        return true;
      } catch (error) {
        setSessions((prev) =>
          prev.map((entry) =>
            entry.id === sessionId && entry.queueStatus === "resuming"
              ? { ...entry, queueStatus: "paused" }
              : entry,
          ),
        );
        throw error;
      } finally {
        manualActions.current.delete(sessionId);
      }
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
