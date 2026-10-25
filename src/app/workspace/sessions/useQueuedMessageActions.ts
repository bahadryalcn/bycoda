import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  type Attachment,
  type MessageQueueStatus,
  type Session,
} from "../../../features/sessions/model/session";
import {
  canDispatchQueuedHead,
  dequeueQueuedMessage,
  queuedMessageForSubmit,
  queuedSteerRoute,
  reorderSessionQueue,
  runningTargetOf,
} from "../../../features/sessions/model/messageQueue";
import { applyQueuedEdit } from "../../../features/sessions/model/queuedMessageEdit";
import {
  settleSharedSend,
  sharedLocalDeliveryUnconfirmed,
  sharedLocalQueueLeaseHeld,
  sharedLocalQueueReady,
  resumeSharedLocalQueue,
} from "../../../features/connections/model/useSharedLocalQueues";
import { QueueNotReadyError } from "../../../features/connections/model/sharedQueue";
import {
  nextQueueStatus,
  planResume,
  queueState,
} from "../../../features/connections/model/queueState";
import {
  lateSettlementPossible,
  requestDeliveryReview,
} from "../../../features/sessions/model/deliveryReview";
import { DeliveryUnknownError } from "../../../shared/lib/deliveryUnknown";
import type { QueueActionResult } from "../../../features/sessions/model/queueAction";
import {
  clearDeliveryProgress,
  readDeliveryProgress,
} from "../../../features/sessions/model/deliveryProgress";
import { steerAppliesModelSettings, type HarnessEvent } from "../../../integrations/harness";
import { type Submit } from "../helpers/types";
import { t } from "../../../shared/i18n";

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
  /** Stop-turn action; filled in after this hook is created. */
  onStopRef: MutableRefObject<(sessionId: string) => void>;
}

/** How long Steer waits for Stop before giving up on a restart. */
const STOP_WAIT_MS = 20_000;
/** How long a queue that could not be coordinated (host busy or unreachable,
 * another computer changed it) waits before its head is offered again. Each
 * further failure doubles the wait up to the cap, so an unreachable host is
 * not polled every two seconds for hours. */
const QUEUE_RETRY_MS = 2_000;
const QUEUE_RETRY_MAX_MS = 60_000;

/** Resume cannot decide an unconfirmed delivery: the inline choice takes focus instead. */
function reviewDelivery(sessionId: string): QueueActionResult {
  requestDeliveryReview(sessionId);
  return {
    kind: "waiting",
    message: t("Choose what happened to the unconfirmed message first, then resume."),
  };
}
/** A given-up send may still be answered by its provider: Resume would risk sending it twice. */
const lateAnswerPending = (): QueueActionResult => ({
  kind: "waiting",
  message: t(
    "The provider has not answered yet and may still deliver this message. Resuming now could send it twice. Wait for the answer, or stop the turn.",
  ),
});
const stillWaiting = (): QueueActionResult => ({
  kind: "waiting",
  message: t("A send is still waiting for confirmation. Try Resume again in a moment."),
});

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
    onStopRef,
  } = deps;
  const queueDispatchingRef = useRef(new Set<string>());
  const manualActions = useRef(new Set<string>());
  const retryAfter = useRef(new Map<string, number>());
  const retryAttempts = useRef(new Map<string, number>());
  const retryTimer = useRef<number>(undefined);
  const [retryTick, setRetryTick] = useState(0);
  useEffect(() => () => window.clearTimeout(retryTimer.current), []);

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
        queueDispatchingRef.current.has(session.id) ||
        (retryAfter.current.get(session.id) ?? 0) > Date.now()
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
          )
            .then(() => {
              retryAttempts.current.delete(session.id);
              retryAfter.current.delete(session.id);
            })
            .catch((error) => {
              if (error instanceof QueueNotReadyError) {
                // Nothing was sent. The queue stays as it is and the head is
                // offered again once the host or the other computer settles.
                const attempt = (retryAttempts.current.get(session.id) ?? 0) + 1;
                retryAttempts.current.set(session.id, attempt);
                const delay = Math.min(QUEUE_RETRY_MS * 2 ** (attempt - 1), QUEUE_RETRY_MAX_MS);
                retryAfter.current.set(session.id, Date.now() + delay);
                window.clearTimeout(retryTimer.current);
                retryTimer.current = window.setTimeout(
                  () => setRetryTick((value) => value + 1),
                  delay,
                );
                return;
              }
              // The provider refused the head, or its delivery is unconfirmed:
              // the queue holds for the owner's decision.
              const event = error instanceof DeliveryUnknownError ? "unknown" : "reject";
              setSessions((sessions) =>
                sessions.map((entry) =>
                  entry.id === session.id
                    ? { ...entry, queueStatus: nextQueueStatus(entry.queueStatus, event) }
                    : entry,
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
  }, [onSubmit, sessions, movingWindows, windowTransferPending, retryTick]);

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

  /** Resolves true once Stop has settled the turn and the row is still queued. */
  const waitUntilIdle = (sessionId: string, messageId: string) =>
    new Promise<boolean>((resolve) => {
      const started = Date.now();
      const check = () => {
        const latest = sessionsRef.current.find((entry) => entry.id === sessionId);
        if (!latest?.queuedMessages?.some((entry) => entry.id === messageId)) return resolve(false);
        if (!latest.busy && !latest.continuingElsewhere && !retiringTurns.current.has(sessionId))
          return resolve(true);
        if (Date.now() - started > STOP_WAIT_MS) return resolve(false);
        window.setTimeout(check, 100);
      };
      check();
    });

  const onSteerQueuedMessage = useCallback(
    async (sessionId: string, messageId: string): Promise<QueueActionResult> => {
      if (manualActions.current.has(sessionId)) return false;
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      const message = session ? queuedMessageForSubmit(session, messageId, "steer") : undefined;
      if (!session) return false;
      if (!message) {
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
      const restart =
        queuedSteerRoute(
          { ...session, busy: !!session.busy || !!session.continuingElsewhere },
          message,
          steerAppliesModelSettings(runningTargetOf(session).harness),
        ) === "restart";
      const queueStatus = session.queueStatus;
      manualActions.current.add(sessionId);
      try {
        // The running turn cannot change model: stop it, then send the row as
        // a new turn with the model it was queued for.
        if (restart) {
          onStopRef.current(sessionId);
          const stopped = await waitUntilIdle(sessionId, messageId);
          if (!stopped)
            throw new Error("The running turn did not stop. The message remains queued.");
        }
        const accepted = await onSubmit(sessionId, message.text, message.attachments, {
          followUpBehavior: "steer",
          queuedMessageId: message.id,
          noteCard: message.noteCard,
          handoffCard: message.handoffCard,
          intent: message.intent,
        });
        // Stop paused the queue; the rows behind this one keep their old status.
        if (restart && accepted && queueStatus !== "paused" && queueStatus !== "resuming")
          setSessions((prev) =>
            prev.map((entry) =>
              entry.id === sessionId && entry.queueStatus === "paused"
                ? { ...entry, queueStatus: queueStatus === "restored" ? "restored" : "active" }
                : entry,
            ),
          );
        return accepted;
      } finally {
        manualActions.current.delete(sessionId);
      }
    },
    [onSubmit, enqueueHarnessEvent, flushHarnessEvents],
  );

  /** Settles a Resume's transient `resuming` status; a Stop in between keeps its own. */
  const settleResuming = (sessionId: string, to: MessageQueueStatus | undefined) =>
    setSessions((prev) =>
      prev.map((entry) =>
        entry.id === sessionId && entry.queueStatus === "resuming"
          ? { ...entry, queueStatus: to }
          : entry,
      ),
    );

  const onResumeQueue = useCallback(
    async (sessionId: string): Promise<QueueActionResult> => {
      if (manualActions.current.has(sessionId)) return false;
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      if (!session || !session.queuedMessages?.length) {
        return false;
      }
      manualActions.current.add(sessionId);
      try {
        // A send still waiting for the provider is answered before anything else
        // is planned; one that never settles is given up and held for review.
        const inFlight = await settleSharedSend(sessionId);
        if (inFlight === "review") return reviewDelivery(sessionId);
        if (inFlight === "pending") return stillWaiting();
        const head = session.queuedMessages[0];
        const state = queueState({
          status: session.queueStatus,
          messages: session.queuedMessages,
          unknownDelivery: await sharedLocalDeliveryUnconfirmed(sessionId),
          rejected: readDeliveryProgress(sessionId, head.id)?.stage === "rejected",
          usageLimit: !!session.usageLimit,
          leaseHeld: sharedLocalQueueLeaseHeld(sessionId),
        });
        const turnRunning = !!session.busy || !!session.continuingElsewhere;
        const plan = planResume(state, {
          turnRunning,
          preparing:
            windowTransferPendingRef.current ||
            movingSessionIds.current.has(sessionId) ||
            retiringTurns.current.has(sessionId) ||
            !!session.historyLoading,
          editing: !!session.editingQueuedMessageId,
        });
        if (plan.do === "none") return false;
        if (plan.do === "blocked") throw new Error(plan.message);
        if (plan.do === "review-delivery") return reviewDelivery(sessionId);
        // Releasing or sending now could send a message twice that its provider may still deliver.
        if (lateSettlementPossible(sessionId)) return lateAnswerPending();
        const resumeShared = async (): Promise<QueueActionResult | undefined> => {
          const outcome = await resumeSharedLocalQueue(
            sessionId,
            () =>
              sessionsRef.current.find((entry) => entry.id === sessionId)?.queueStatus ===
              "resuming",
          );
          if (outcome === "resumed") return undefined;
          // Nothing was released: the queue stays as it was, with the reason shown.
          settleResuming(sessionId, session.queueStatus ?? "paused");
          return outcome === "review"
            ? reviewDelivery(sessionId)
            : outcome === "late"
              ? lateAnswerPending()
              : stillWaiting();
        };
        const beginResume = () =>
          setSessions((prev) =>
            prev.map((entry) =>
              entry.id === sessionId
                ? { ...entry, queueStatus: nextQueueStatus(entry.queueStatus, "resume-start") }
                : entry,
            ),
          );
        if (plan.do === "release") {
          // A turn on this or the other computer: the queue drains once it ends.
          // No synthetic continue message is invented for a turn someone else runs.
          beginResume();
          const held = await resumeShared();
          if (held) return held;
          settleResuming(sessionId, nextQueueStatus("resuming", "resume-done"));
          return {
            kind: "waiting",
            message: turnRunning
              ? t("Queue resumed. Messages will send when this turn finishes.")
              : t("Queue resumed. The next message is being prepared."),
          };
        }
        if (plan.do === "send-head") {
          return await onSubmit(sessionId, head.text, head.attachments, {
            followUpBehavior: "steer",
            queuedMessageId: head.id,
            noteCard: head.noteCard,
            handoffCard: head.handoffCard,
            intent: head.intent,
          });
        }
        return false;
      } catch (error) {
        settleResuming(sessionId, nextQueueStatus("resuming", "resume-failed"));
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
