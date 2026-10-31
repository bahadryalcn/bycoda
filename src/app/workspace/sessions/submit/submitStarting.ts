import type { SubmitDeps, SubmitInput, SubmitPreflight } from "./submitTypes";

import { setSessions } from "../../../../features/sessions/model/sessionsStore";
import { t } from "../../../../shared/i18n";
import type { SubmissionAcceptance } from "../../../model/submissionAcceptance";
import { queueSubmittedFollowUp } from "./submitBusySteer";
import { showSubmitNotice } from "./submitNotice";

/** One keyed transcript row, shown only while a send is waiting to start. */
const STARTING_STATUS_KEY = "send-starting";
/** A start that settles quickly never flashes the row. */
const STARTING_STATUS_DELAY_MS = 400;

/** Sessions whose send is still starting with no turn running yet, with a count per session. */
const startingSends = new Map<string, number>();

/** True while a send waits to start and no turn is running: Stop then has no turn to mark stopped. */
export function isSendStarting(sessionId: string): boolean {
  return startingSends.has(sessionId);
}

/**
 * The generation a send that is still starting waits under. An idle
 * conversation takes a new one (Stop or a newer turn moves it on, which cancels
 * the wait). A conversation that is already running keeps its own generation,
 * so the running turn is not superseded before the replacing send really
 * starts, but Stop still cancels the wait.
 */
export function claimStartingGeneration(
  ctx: SubmitDeps,
  sessionId: string,
  replacesRunningTurn: boolean | undefined,
): { gen: number; marked: boolean; isCurrent: () => boolean } {
  const { turnGen } = ctx.refs;
  const marked = !replacesRunningTurn;
  const current = turnGen.current.get(sessionId) ?? 0;
  const gen = marked ? current + 1 : current;
  if (marked) turnGen.current.set(sessionId, gen);
  return { gen, marked, isCurrent: () => (turnGen.current.get(sessionId) ?? 0) === gen };
}

export interface SendStarting {
  /** The turn adds the message next: drop the row and the "preparing" mark, keep `busy` without a gap. */
  handOver: () => void;
  /** The send did not start. `restoreMarks` is false when a newer turn or Stop already owns them. */
  release: (restoreMarks: boolean) => void;
}

/**
 * Shows that a send the composer already cleared is still starting (waiting for
 * the run lease, guidance or the usage-budget check): the conversation is busy
 * with a queueing "preparing" state, so Stop works and a second message is
 * queued instead of lost. Call it before the user's message is added to the
 * transcript.
 */
export function beginSendStarting(
  ctx: SubmitDeps,
  sessionId: string,
  previousBusy: boolean | undefined,
): SendStarting {
  const { enqueueHarnessEvent, flushHarnessEvents } = ctx;
  // A fresh start has no running turn yet. Stop then has nothing to mark
  // "Stopped by you" (useSessionStop reads isSendStarting before it marks).
  const freshStart = !previousBusy;
  if (freshStart) startingSends.set(sessionId, (startingSends.get(sessionId) ?? 0) + 1);
  let counted = freshStart;
  const uncount = () => {
    if (!counted) return;
    counted = false;
    const left = (startingSends.get(sessionId) ?? 1) - 1;
    if (left > 0) startingSends.set(sessionId, left);
    else startingSends.delete(sessionId);
  };
  setSessions((all) =>
    all.map((s) => (s.id === sessionId ? { ...s, busy: true, worktreePreparing: true } : s)),
  );
  let shown = false;
  let cleared = false;
  const timer = setTimeout(() => {
    shown = true;
    enqueueHarnessEvent(sessionId, {
      type: "status",
      key: STARTING_STATUS_KEY,
      text: t("Starting your message…"),
    });
    flushHarnessEvents();
  }, STARTING_STATUS_DELAY_MS);
  const clearRow = () => {
    if (cleared) return;
    cleared = true;
    clearTimeout(timer);
    if (!shown) return;
    enqueueHarnessEvent(sessionId, { type: "status", key: STARTING_STATUS_KEY, text: "" });
    flushHarnessEvents();
  };
  const unmark = (busy?: { value: boolean | undefined }) =>
    setSessions((all) =>
      all.map((s) =>
        s.id === sessionId
          ? { ...s, worktreePreparing: undefined, ...(busy ? { busy: busy.value } : {}) }
          : s,
      ),
    );
  return {
    handOver: () => {
      uncount();
      clearRow();
      unmark();
    },
    release: (restoreMarks) => {
      uncount();
      clearRow();
      if (restoreMarks) unmark({ value: previousBusy });
    },
  };
}

/**
 * A second send while the first is still starting (lease, guidance, usage check)
 * joins the queue and goes out next: nothing is lost and no second turn starts.
 * Content the queue cannot take over is refused with the reason in the transcript.
 */
export function queueWhileStarting(
  ctx: SubmitDeps,
  input: SubmitInput,
  pre: SubmitPreflight,
  reason: string,
): SubmissionAcceptance {
  const { options } = input;
  if (
    options?.managed ||
    options?.appRequestId ||
    options?.ciRepair ||
    options?.draftBlockId ||
    options?.queuedMessageId ||
    pre.editedResend
  ) {
    pre.editedResend?.reject();
    showSubmitNotice(input.sessionId, reason);
    return false;
  }
  return queueSubmittedFollowUp(ctx, input, pre);
}
