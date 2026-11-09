import type { SubmitDeps, SubmitInput, SubmitPreflight } from "./submitTypes";

import {
  acquireRunLease,
  firstRunLeaseLook,
  releaseRunLease,
  runLeaseMachine,
  isRunLeaseDiscoveryPending,
} from "../../../../features/connections/model/runLeaseClient";
import {
  holdUndeliveredFollowUp,
  queuedModelTarget,
} from "../../../../features/sessions/model/messageQueue";
import { setSessions } from "../../../../features/sessions/model/sessionsStore";
import type { SubmissionAcceptance } from "../../../model/submissionAcceptance";
import { queueSubmittedFollowUp } from "./submitBusySteer";
import { beginSendStarting, claimStartingGeneration } from "./submitStarting";
import { showSubmitNotice } from "./submitNotice";
import { QueueDeferredError } from "../../../../features/connections/model/sharedQueue";
import { t } from "../../../../shared/i18n";

/** Conversations whose send is waiting for its lease, by the generation that owns the wait. */
const starting = new Map<string, number>();
export function isRunLeaseStarting(sessionId: string, generation: number | undefined): boolean {
  return starting.get(sessionId) === (generation ?? 0);
}

/**
 * The runtime hints and skill restrictions are optional for a turn. A Host that
 * is slow to answer them must not hold the message back: after this long the
 * turn starts without them and the lookup keeps filling its cache.
 */
export const PREPARATION_WAIT_MS = 2000;

async function settleWithin(work: Promise<unknown> | undefined, ms: number): Promise<void> {
  if (!work) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** A queued row whose turn changed while it waited: it stays queued for a later look. */
const turnChangedDeferral = () =>
  new QueueDeferredError(
    t("The conversation changed while this queued message was waiting. It remains queued."),
  );

/**
 * Takes the conversation's run lease from the home host just before a turn
 * starts here. When another computer runs one, the message is not started: it
 * is queued (or, for a queue row, left in place), the conversation shows as
 * running elsewhere, and nothing is paused or copied. Resolves `undefined` when
 * there is no lease to take, so the turn starts exactly as it did before.
 */
export function gateRunLease(
  ctx: SubmitDeps,
  input: SubmitInput,
  pre: SubmitPreflight,
  start: () => SubmissionAcceptance,
  prepare?: () => Promise<unknown>,
): SubmissionAcceptance | undefined {
  // The very first turn of a run waits for the first look at the host (briefly),
  // so it takes its lease like every later turn instead of racing ahead of it.
  const firstLook = runLeaseMachine() ? undefined : firstRunLeaseLook();
  if (!firstLook && !runLeaseMachine()) return undefined;
  const { sessionId, options } = input;
  // Speculative guidance never starts a provider and failures are retried by
  // the normal fail-closed send path. Observe them even when the lease is held.
  const preparation = prepare ? Promise.allSettled([Promise.resolve().then(prepare)]) : undefined;
  // The composer has already cleared: until the turn starts, the conversation
  // shows it is starting (busy, Stop works, a second message is queued). A
  // running turn that this send replaces keeps its own state. Either way the
  // wait is registered, so a second message queues instead of starting a second
  // turn, and Stop cancels it.
  const { marked, gen, isCurrent } = claimStartingGeneration(ctx, sessionId, pre.current.busy);
  starting.set(sessionId, gen);
  const sending = marked
    ? beginSendStarting(ctx, sessionId, pre.current.busy)
    : { handOver: () => undefined, release: (_restoreMarks: boolean) => undefined };
  // Stop (or a newer turn) took over while the send was waiting: nothing starts,
  // and the message goes back to the composer or the paused queue.
  const recoverUnstarted = () => {
    pre.editedResend?.reject();
    if (
      options?.queuedMessageId ||
      options?.draftBlockId ||
      pre.editedResend ||
      options?.onSendRejected?.()
    )
      return;
    const recovery = {
      id: crypto.randomUUID(),
      text: input.text,
      attachments: input.attachments,
      noteCard: pre.noteCard,
      handoffCard: pre.handoffCard,
      intent: pre.intent,
      modelTarget: queuedModelTarget(options?.buildTarget ?? pre.storedCurrent),
    };
    setSessions((all) =>
      all.map((s) => (s.id === sessionId ? holdUndeliveredFollowUp(s, recovery) : s)),
    );
  };
  return (async () => {
    let accepted = false;
    let granted = false;
    try {
      if (firstLook) {
        await firstLook;
        if (!runLeaseMachine()) {
          if (!isRunLeaseDiscoveryPending()) return await startWhenCurrent();
          if (!options?.managed && !options?.appRequestId && !options?.ciRepair) recoverUnstarted();
          else options?.onSendRejected?.();
          const text =
            "Message not sent: Host ownership discovery is still pending. Your message is retained; check the Host connection before continuing.";
          showSubmitNotice(sessionId, text, "error");
          options?.onSettled?.({ status: "failed", text: "", error: text });
          return false;
        }
      }
      const outcome = await acquireRunLease(sessionId);
      granted = outcome.kind === "granted";
      if (outcome.kind === "failed") {
        if (!options?.managed && !options?.appRequestId && !options?.ciRepair) recoverUnstarted();
        else options?.onSendRejected?.();
        showSubmitNotice(sessionId, outcome.text, "error");
        options?.onSettled?.({ status: "failed", text: "", error: outcome.text });
        return false;
      }
      if (outcome.kind !== "held") return await startWhenCurrent();
      // The other computer's turn is what the queue waits for: the dispatcher
      // reads this as a wait, not as a refused send.
      if (!isCurrent()) {
        recoverUnstarted();
        // A queue row stays queued: the turn changed, which is a wait, not a refusal.
        if (options?.queuedMessageId) throw turnChangedDeferral();
        return false;
      }
      sending.release(true);
      setSessions((all) =>
        all.map((session) =>
          session.id === sessionId ? { ...session, continuingElsewhere: true } : session,
        ),
      );
      if (options?.managed) {
        options.onSettled?.({
          status: "failed",
          text: "",
          error: "Session is unavailable or already running",
        });
        return false;
      }
      // These carry content the queue cannot take over: the caller keeps it.
      if (options?.appRequestId || options?.ciRepair || options?.draftBlockId || pre.editedResend) {
        pre.editedResend?.reject();
        return false;
      }
      return queueSubmittedFollowUp(ctx, input, pre);
    } finally {
      if (starting.get(sessionId) === gen) starting.delete(sessionId);
      // A send that never started gives back what it marked; a started turn owns it.
      if (!accepted) sending.release(isCurrent());
    }

    async function startWhenCurrent(): Promise<boolean> {
      // A turn that throws before it runs must not leave the lease behind.
      try {
        await settleWithin(preparation, PREPARATION_WAIT_MS);
        if (!isCurrent()) {
          recoverUnstarted();
          if (options?.queuedMessageId) throw turnChangedDeferral();
          return false;
        }
        // The turn adds the message next, so the starting row goes now; `busy`
        // stays on without a gap.
        sending.handOver();
        accepted = await start();
      } finally {
        if (granted && !accepted) await releaseRunLease(sessionId);
      }
      return accepted;
    }
  })();
}
