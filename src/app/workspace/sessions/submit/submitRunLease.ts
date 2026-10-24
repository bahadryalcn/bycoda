import type { SubmitDeps, SubmitInput, SubmitPreflight } from "./submitTypes";

import {
  acquireRunLease,
  firstRunLeaseLook,
  releaseRunLease,
  runLeaseMachine,
} from "../../../../features/connections/model/runLeaseClient";
import { setSessions } from "../../../../features/sessions/model/sessionsStore";
import type { SubmissionAcceptance } from "../../../model/submissionAcceptance";
import { queueSubmittedFollowUp } from "./submitBusySteer";

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
): SubmissionAcceptance | undefined {
  // The very first turn of a run waits for the first look at the host (briefly),
  // so it takes its lease like every later turn instead of racing ahead of it.
  const firstLook = runLeaseMachine() ? undefined : firstRunLeaseLook();
  if (!firstLook && !runLeaseMachine()) return undefined;
  const { sessionId, options } = input;
  return (async () => {
    if (firstLook) {
      await firstLook;
      if (!runLeaseMachine()) return start();
    }
    const outcome = await acquireRunLease(sessionId);
    if (outcome.kind !== "held") {
      // A turn that throws before it runs must not leave the lease behind.
      let accepted: boolean = false;
      try {
        accepted = await start();
      } finally {
        if (outcome.kind === "granted" && !accepted) await releaseRunLease(sessionId);
      }
      return accepted;
    }
    // The other computer's turn is what the queue waits for: the dispatcher
    // reads this as a wait, not as a refused send.
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
  })();
}
