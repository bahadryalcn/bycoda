import { isLeaseHeld } from "../../sync/model/runLease";
import { hasMissingAttachment } from "../../sessions/model/queuePersistence";
import type { MessageQueueStatus, QueuedMessage } from "../../sessions/model/session";

/**
 * One state machine for a message queue, used by the desktop dispatcher, the
 * remote pane and the host-facing clients. It is pure: callers read facts from
 * their own stores and apply the answer.
 *
 *  - active   drains its head when the conversation is free
 *  - paused   the owner's intent (Stop or Pause on any computer)
 *  - held     a system hold with a reason that needs a decision, not a wait
 *  - resuming transient, only while a Resume is in flight, never persisted
 *  - restored a queue that came back from disk in a local (not shared) chat.
 *             A shared queue is never restored: while another window holds its
 *             drain lease it is `held` / `lease`, otherwise it is simply active
 *             (the lease holder, or the home host, sends it).
 *
 * `paused` stays the one persisted word for every stop of the queue. A hold is
 * derived from facts at hand (an unconfirmed delivery, a usage limit, ...), so
 * old hosts, saved queues and the mobile app keep reading the same status.
 * Coordination trouble (host unreachable, claim race, busy elsewhere, a lease
 * held by another computer) is not a state: it changes nothing and is retried.
 */
export type QueueHoldReason =
  | "rejected"
  | "unknown"
  | "usage-limit"
  | "conflict"
  | "missing-attachment"
  /** Another window holds the queue's drain lease and sends it; Resume takes it over. */
  | "lease";

export type QueueState =
  | { kind: "active" }
  | { kind: "paused" }
  | { kind: "resuming" }
  | { kind: "restored" }
  | { kind: "held"; reason: QueueHoldReason };

/** The host refuses to steer a turn a desktop owns (and, with `LEASE_HELD`, any
 * turn another side runs). The follow-up waits its turn in the queue. */
const STEER_BUSY_ELSEWHERE = /cannot be redirected through the host/i;

/**
 * What a follow-up the host did not take means for its queue. An explicit
 * refusal is a failed delivery (`reject`: held for the owner). Anything else,
 * including the busy-elsewhere refusal, an unreachable host or no answer,
 * sent nothing and changes nothing (`coordination`).
 */
export function followUpRefusalEvent(failure?: string): QueueEvent {
  return failure &&
    /Host rejected request:/.test(failure) &&
    !STEER_BUSY_ELSEWHERE.test(failure) &&
    !isLeaseHeld(failure)
    ? "reject"
    : "coordination";
}

export type QueueFacts = {
  status?: MessageQueueStatus;
  messages: readonly QueuedMessage[];
  /** A sent head has no acknowledgement (journal recovery or a flagged row). */
  unknownDelivery?: boolean;
  /** The provider refused the head; it is intact and waits for a decision. */
  rejected?: boolean;
  usageLimit?: boolean;
  /** The adopted conversation diverged from the host copy. */
  conflict?: boolean;
  /** Another window holds the shared queue's live drain lease. */
  leaseHeld?: boolean;
};

/** The state a queue is in, given what its owner can see. */
export function queueState(facts: QueueFacts): QueueState {
  if (!facts.messages.length) return { kind: "active" };
  const head = facts.messages[0];
  if (facts.unknownDelivery || facts.messages.some((row) => row.deliveryUnknown))
    return { kind: "held", reason: "unknown" };
  if (facts.leaseHeld) return { kind: "held", reason: "lease" };
  if (facts.usageLimit) return { kind: "held", reason: "usage-limit" };
  if (facts.conflict) return { kind: "held", reason: "conflict" };
  if (hasMissingAttachment(head)) return { kind: "held", reason: "missing-attachment" };
  if (facts.status === "resuming") return { kind: "resuming" };
  if (facts.status === "restored") return { kind: "restored" };
  if (facts.status === "paused")
    return facts.rejected ? { kind: "held", reason: "rejected" } : { kind: "paused" };
  return { kind: "active" };
}

export type QueueEvent =
  /** Stop, or the Pause button, on any computer. */
  | "pause"
  /** The provider refused the head: it stays queued and waits for a decision. */
  | "reject"
  /** A send has no acknowledgement; it must not be sent again on its own. */
  | "unknown"
  /** Host unreachable, claim race, lease held, busy elsewhere: nothing was sent. */
  | "coordination"
  /** Resume on any computer: the queue drains again, no ownership transfer needed. */
  | "resume"
  | "resume-start"
  | "resume-done"
  | "resume-failed";

/**
 * The persisted status after an event. A queue with no rows has no status.
 * `resume-done` and `resume-failed` only settle the Resume that started them:
 * a Stop or a newer Resume in between keeps its own status.
 */
export function nextQueueStatus(
  status: MessageQueueStatus | undefined,
  event: QueueEvent,
): MessageQueueStatus | undefined {
  switch (event) {
    case "coordination":
      return status;
    case "pause":
      return "paused";
    case "reject":
    case "unknown":
      // A restored queue keeps waiting for the owner's choice to send next.
      return status === "restored" ? "restored" : "paused";
    case "resume":
      return "active";
    case "resume-start":
      return "resuming";
    case "resume-done":
      return status === "resuming" ? "active" : status;
    case "resume-failed":
      return status === "resuming" ? "paused" : status;
  }
}

export type ResumeContext = {
  /** A turn is running here, or the host runs this conversation for another computer. */
  turnRunning: boolean;
  /** A window move, handoff or history load is still settling. */
  preparing: boolean;
  /** The head is open in the edit dialog. */
  editing: boolean;
};

export type ResumePlan =
  | { do: "none" }
  /** Show the inline delivered / send again / discard choice. */
  | { do: "review-delivery" }
  | { do: "blocked"; message: string }
  /** Set the queue active; the dispatcher sends the head when the conversation is free. */
  | { do: "release" }
  /** Send the head now (a restored queue's "Send next"). */
  | { do: "send-head" };

/** What Resume does in a state. Every state has an answer; none is a dead button. */
export function planResume(state: QueueState, context: ResumeContext): ResumePlan {
  if (state.kind === "held" && state.reason === "unknown") return { do: "review-delivery" };
  if (context.preparing)
    return { do: "blocked", message: "This conversation is still preparing. Wait and try again." };
  if (state.kind === "held" && state.reason === "usage-limit")
    return {
      do: "blocked",
      message: "The usage limit is holding this queue. Resolve the limit before resuming.",
    };
  if (context.editing)
    return { do: "blocked", message: "Finish editing the queued message before resuming." };
  if (state.kind === "held" && state.reason === "missing-attachment")
    return {
      do: "blocked",
      message: "An attachment is missing. Edit the queued message before resuming.",
    };
  // Resume is "set active and wake the drainer", in every state. It never
  // invents a "Continue from where you left off" message: continuing an
  // interrupted turn is its own explicit action (the interrupted-turn notice).
  if (context.turnRunning) return { do: "release" };
  if (state.kind === "restored") return { do: "send-head" };
  return { do: "release" };
}
