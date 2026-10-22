import { isPreparingHandoff } from "./handoff";
import type { FollowUpBehavior } from "../../settings/model/settings";
import { moveItem, orderByIds } from "../../../shared/lib/reorder";
import { hasMissingAttachment } from "./queuePersistence";
import type { ModelTarget, QueuedMessage, Session, TurnIntent } from "./session";

export function queuedModelTarget(
  session: Pick<Session, "harness" | "model" | "modelSettings">,
): ModelTarget {
  return {
    harness: session.harness,
    model: session.model,
    modelSettings: { ...session.modelSettings },
  };
}

export function sameQueuedModelTarget(a: ModelTarget, b: ModelTarget): boolean {
  return (
    a.harness === b.harness &&
    a.model === b.model &&
    Object.keys(a.modelSettings).length === Object.keys(b.modelSettings).length &&
    Object.entries(a.modelSettings).every(([key, value]) => b.modelSettings[key] === value)
  );
}

export function queuedHead(session: Session): QueuedMessage | undefined {
  return session.queuedMessages?.[0];
}

/** Adding work never resumes a queue held for owner review. */
export function appendQueuedMessage(session: Session, message: QueuedMessage): Session {
  if (session.queuedMessages?.some((entry) => entry.id === message.id)) return session;
  return {
    ...session,
    queuedMessages: [...(session.queuedMessages ?? []), message],
    queueStatus:
      session.queueStatus === "paused" || session.queueStatus === "restored"
        ? session.queueStatus
        : "active",
  };
}

/** Keep an undelivered follow-up reviewable after Stop, without auto-restarting. */
export function holdUndeliveredFollowUp(
  session: Session,
  message: QueuedMessage,
  userBlockId?: string,
): Session {
  return {
    ...session,
    blocks: userBlockId
      ? session.blocks.filter((block) => block.id !== userBlockId)
      : session.blocks,
    queuedMessages: session.queuedMessages?.some((entry) => entry.id === message.id)
      ? session.queuedMessages.map((entry) =>
          entry.id === message.id && message.deliveryUnknown
            ? { ...entry, deliveryUnknown: true }
            : entry,
        )
      : [...(session.queuedMessages ?? []), message],
    queueStatus: "paused",
  };
}

/** Hold auto-dispatch only while the item about to send is being edited. */
export function isEditingQueuedHead(session: Session): boolean {
  const head = queuedHead(session);
  return Boolean(head && session.editingQueuedMessageId === head.id);
}

export function dequeueQueuedMessage(session: Session, messageId: string): Session {
  const queuedMessages = (session.queuedMessages ?? []).filter(
    (message) => message.id !== messageId,
  );
  return {
    ...session,
    queuedMessages: queuedMessages.length > 0 ? queuedMessages : undefined,
    queueStatus: queuedMessages.length > 0 ? session.queueStatus : undefined,
    editingQueuedMessageId:
      session.editingQueuedMessageId === messageId ? undefined : session.editingQueuedMessageId,
  };
}

/**
 * Move one queued row to `toIndex` (clamped to the queue). Returns the same
 * array when the row is unknown or already there, so callers can skip a write.
 */
export function moveQueuedMessage(
  queue: QueuedMessage[],
  fromId: string,
  toIndex: number,
): QueuedMessage[] {
  const from = queue.findIndex((message) => message.id === fromId);
  if (from < 0) return queue;
  const to = Math.max(0, Math.min(Math.trunc(toIndex), queue.length - 1));
  return moveItem(queue, from, to);
}

/**
 * Put the queue in the order of `ids`, resolved against the queue as it is now:
 * ids that are gone are ignored and rows added since keep their place at the
 * end, so a drop that raced a send, a removal or a new message cannot lose or
 * duplicate a row. Returns the same array when nothing moves.
 */
export function reorderQueuedMessages(queue: QueuedMessage[], ids: string[]): QueuedMessage[] {
  const next = orderByIds(queue, ids);
  return next.every((message, index) => message === queue[index]) ? queue : next;
}

/** Reorder a session's queue. Status and the edited row are left alone: order is all that changes. */
export function reorderSessionQueue(session: Session, ids: string[]): Session {
  const queue = session.queuedMessages;
  if (!queue) return session;
  const next = reorderQueuedMessages(queue, ids);
  return next === queue ? session : { ...session, queuedMessages: next };
}

/**
 * A queued row was sent: take it out, and let a queue restored after a restart
 * go back to draining, since the user has just chosen to send from it.
 */
export function sentQueuedMessage(session: Session, messageId: string): Session {
  const next = dequeueQueuedMessage(session, messageId);
  return next.queueStatus === "restored" ? { ...next, queueStatus: "active" } : next;
}

/**
 * True when the idle session can send its queued head as a new turn.
 * Busy / paused / resuming / restored / usage-limited / preparing-handoff /
 * editing-the-head / a head whose attachment is gone all wait.
 */
export function canDispatchQueuedHead(session: Session): boolean {
  if (session.busy) return false;
  // The host is running this conversation, or its finished turn has not been
  // applied here yet: a local turn now would fork the transcript.
  if (session.continuingElsewhere || session.adoptedSyncConflict) return false;
  if (session.usageLimit) return false;
  if (
    session.queueStatus === "paused" ||
    session.queueStatus === "resuming" ||
    session.queueStatus === "restored"
  ) {
    return false;
  }
  const head = queuedHead(session);
  if (!head) return false;
  if (head.deliveryUnknown) return false;
  if (hasMissingAttachment(head)) return false;
  if (isEditingQueuedHead(session)) return false;
  if (isPreparingHandoff(session)) return false;
  return true;
}

/** Resolve a queued row for auto-dispatch (head, idle) or an explicit Steer. */
export function queuedMessageForSubmit(
  session: Session,
  messageId: string,
  mode: "dispatch" | "steer",
): QueuedMessage | undefined {
  const message = session.queuedMessages?.find((entry) => entry.id === messageId);
  if (!message || message.deliveryUnknown || hasMissingAttachment(message)) return undefined;
  if (mode === "steer") {
    if (session.busy && (message.intent === "plan" || message.intent === "orchestrate"))
      return undefined;
    if (
      session.busy &&
      message.modelTarget &&
      !sameQueuedModelTarget(
        message.modelTarget,
        session.runningModelTarget ?? queuedModelTarget(session),
      )
    )
      return undefined;
    return message;
  }
  if (queuedHead(session)?.id !== messageId) return undefined;
  if (!canDispatchQueuedHead(session)) return undefined;
  return message;
}

export type FollowUpRoute = "dispatch" | "queue" | "steer";

/**
 * Where a message sent from the composer goes. Idle sessions dispatch. While a
 * turn is open the message is queued when the app must (a worktree is still
 * preparing; plan, orchestrate and /operator start their own turn), steered
 * when only background tasks keep the turn open (they may never end, so a
 * queued message would be parked behind them), and otherwise follows
 * `requested` (an explicit per-send choice), defaulting to steer.
 *
 * An explicit "queue" beats the background-task steer unless the agent has
 * truly yielded (`backgroundOnly`), because with the agent still working the
 * queued message is sent when that turn ends.
 */
export function resolveFollowUpRoute(input: {
  busy: boolean;
  worktreePreparing?: boolean;
  intent: TurnIntent;
  operatorCommand: boolean;
  backgroundTaskCount: number;
  backgroundOnly: boolean;
  requested?: FollowUpBehavior;
}): FollowUpRoute {
  if (!input.busy) return "dispatch";
  if (
    input.worktreePreparing ||
    input.intent === "plan" ||
    input.intent === "orchestrate" ||
    input.operatorCommand
  ) {
    return "queue";
  }
  if (input.requested === "queue" && !input.backgroundOnly) return "queue";
  if (input.backgroundTaskCount > 0) return "steer";
  return input.requested ?? "steer";
}
