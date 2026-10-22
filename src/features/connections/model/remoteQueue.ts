import { canDispatchQueuedHead, reorderQueuedMessages } from "../../sessions/model/messageQueue";
import { applyQueuedEdit } from "../../sessions/model/queuedMessageEdit";
import type {
  Attachment,
  MessageQueueStatus,
  QueuedMessage,
  Session,
  TurnIntent,
} from "../../sessions/model/session";

/**
 * Follow-ups queued behind a turn running on another machine.
 *
 * These pure transitions serve both legacy device queues and durable shared
 * host queues. One client drains a shared queue; other computers can edit it.
 * The owning desktop or an open remote pane dispatches its messages.
 */

export type RemoteQueue = {
  messages: QueuedMessage[];
  status?: MessageQueueStatus;
  /** The row whose edit dialog is open; the queue does not send it meanwhile. */
  editingId?: string;
};

export const EMPTY_REMOTE_QUEUE: RemoteQueue = { messages: [] };
export const REMOTE_QUEUE_MAX_MESSAGES = 100;
export const REMOTE_QUEUE_MAX_BYTES = 32 * 1024 * 1024;

/** Upper bound without serializing/copying attachment bodies. Existing saved
 * queues are never truncated; a full queue leaves the next draft in the composer. */
export function canEnqueueRemoteMessage(queue: RemoteQueue, message: RemoteQueueDraft): boolean {
  if (queue.messages.length >= REMOTE_QUEUE_MAX_MESSAGES) return false;
  return queueWithinByteLimit([...queue.messages, message]);
}

function queueWithinByteLimit(messages: readonly RemoteQueueDraft[]): boolean {
  let bytes = 0;
  for (const entry of messages) {
    bytes += entry.text.length * 3;
    for (const attachment of entry.attachments) {
      bytes += (attachment.data?.length ?? 0) * 2;
    }
    if (bytes > REMOTE_QUEUE_MAX_BYTES) return false;
  }
  return true;
}

export type RemoteQueueDraft = {
  modelTarget?: QueuedMessage["modelTarget"];
  id: string;
  text: string;
  attachments: Attachment[];
  intent?: TurnIntent;
};

/** The fields a session carries for its queue, for the pane and the shared model. */
export function queueSessionFields(
  queue: RemoteQueue,
): Pick<Session, "queuedMessages" | "queueStatus" | "editingQueuedMessageId"> {
  return {
    queuedMessages: queue.messages.length > 0 ? queue.messages : undefined,
    queueStatus: queue.messages.length > 0 ? queue.status : undefined,
    editingQueuedMessageId: queue.editingId,
  };
}

export function enqueueRemoteMessage(queue: RemoteQueue, message: RemoteQueueDraft): RemoteQueue {
  if (!canEnqueueRemoteMessage(queue, message)) throw new Error("Remote queue is full");
  return {
    ...queue,
    messages: [...queue.messages, message],
    // Adding work never releases a queue held for owner review.
    status: queue.status === "paused" || queue.status === "restored" ? queue.status : "active",
  };
}

export function removeRemoteMessage(queue: RemoteQueue, messageId: string): RemoteQueue {
  const messages = queue.messages.filter((entry) => entry.id !== messageId);
  return {
    messages,
    status: messages.length > 0 ? queue.status : undefined,
    editingId: queue.editingId === messageId ? undefined : queue.editingId,
  };
}

export function editRemoteMessage(
  queue: RemoteQueue,
  messageId: string,
  text: string,
  attachments: Attachment[],
): RemoteQueue {
  const messages = queue.messages.map((entry) =>
    entry.id === messageId ? applyQueuedEdit(entry, { text, attachments }) : entry,
  );
  if (!queueWithinByteLimit(messages)) throw new Error("Remote queue is full");
  return {
    ...queue,
    messages,
    editingId: undefined,
  };
}

/** Drag or keyboard reorder: only the order changes, never the status or the edited row. */
export function reorderRemoteMessages(queue: RemoteQueue, ids: string[]): RemoteQueue {
  const messages = reorderQueuedMessages(queue.messages, ids);
  return messages === queue.messages ? queue : { ...queue, messages };
}

export function setRemoteEditing(queue: RemoteQueue, messageId?: string): RemoteQueue {
  return queue.editingId === messageId ? queue : { ...queue, editingId: messageId };
}

/** "Send next" on a restored queue and "Resume" on a paused one: let it drain. */
export function releaseRemoteQueue(queue: RemoteQueue): RemoteQueue {
  return queue.messages.length > 0 && queue.status !== "active"
    ? { ...queue, status: "active" }
    : queue;
}

/** The user stopped the turn: what is queued waits for them instead of sending next. */
export function pauseRemoteQueue(queue: RemoteQueue): RemoteQueue {
  return queue.messages.length > 0 && queue.status !== "paused"
    ? { ...queue, status: "paused" }
    : queue;
}

/** A row went out as a turn: it leaves the queue, and a restored queue drains on. */
export function sentRemoteMessage(queue: RemoteQueue, messageId: string): RemoteQueue {
  const next = removeRemoteMessage(queue, messageId);
  return next.status === "restored" ? { ...next, status: "active" } : next;
}

/**
 * Whether a message from the composer waits in the queue. A host turn cannot be
 * steered, so anything sent while the chat is busy (or while an earlier send is
 * still being confirmed) queues. Saved drafts never do.
 */
export function shouldQueueRemoteMessage(input: {
  busy: boolean;
  /** An earlier command is still in flight to the host. */
  working: boolean;
  asDraft: boolean;
}): boolean {
  return !input.asDraft && (input.busy || input.working);
}

/**
 * The queued row to send now, if any. `session` is the chat as the pane sees it
 * (busy, usage limit and the queue fields). On top of the local rules the
 * machine must be reachable: a queue is held while it is not, and nothing is
 * sent into the void.
 */
export function nextRemoteQueuedMessage(input: {
  session: Session;
  loaded: boolean;
  online: boolean;
  /** The connection state allows a request (not unreachable, not waiting for a sign-in). */
  canSend: boolean;
  /** A command (send, configure, approval) is in flight or waiting for the host. */
  working: boolean;
  /** A change of model or mode waits for the chat to be idle. */
  changing: boolean;
}): QueuedMessage | undefined {
  if (!input.loaded || !input.online || !input.canSend) return undefined;
  if (input.working || input.changing) return undefined;
  if (!canDispatchQueuedHead(input.session)) return undefined;
  return input.session.queuedMessages?.[0];
}
