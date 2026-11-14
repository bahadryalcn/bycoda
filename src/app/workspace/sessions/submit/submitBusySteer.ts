import type { SubmitDeps, SubmitInput, SubmitPreflight } from "./submitTypes";

import { nextQueueStatus } from "../../../../features/connections/model/queueState";
import { inboxAskPrompt } from "../../../../features/inbox/model/inboxAsk";
import { isBackgroundOnly } from "../../../../features/sessions/model/activityDock";
import {
  displayAttachments,
  prepareAttachments,
} from "../../../../features/sessions/model/attachments";
import {
  appendQueuedMessage,
  holdUndeliveredFollowUp,
  queuedModelTarget,
  resolveFollowUpRoute,
  runningTargetOf,
  sentQueuedMessage,
} from "../../../../features/sessions/model/messageQueue";
import { preparePrompt } from "../../../../features/sessions/model/promptPreparation";
import { submitDelegationKey } from "./submitDelegationKey";
import { type Session } from "../../../../features/sessions/model/session";
import { sessionsRef, setSessions } from "../../../../features/sessions/model/sessionsStore";
import {
  appendSteerUser,
  canSteerHarness,
  isLiveHarness,
  steerHarnessTurn,
} from "../../../../integrations/harness";
import { t } from "../../../../shared/i18n";
import { TurnNotReadyError } from "../../../../integrations/harness/core/types";
import { QueueDeferredError } from "../../../../features/connections/model/sharedQueue";
import { clearDeliveryProgress } from "../../../../features/sessions/model/deliveryProgress";
import { type SubmissionAcceptance } from "../../../model/submissionAcceptance";
import { userTurnCards } from "../../helpers/sessionHelpers";
import { DeliveryUnknownError } from "../../../../shared/lib/deliveryUnknown";
import { trackLateSettlement } from "../../../../features/sessions/model/deliveryReview";
import { markSharedProviderSend } from "../../../../features/connections/model/useSharedLocalQueues";
import {
  beginDeliveryProgress,
  readDeliveryProgress,
  updateDeliveryProgress,
} from "../../../../features/sessions/model/deliveryProgress";
import {
  adoptedFollowUpPending,
  sendAdoptedFollowUp,
} from "../../../../features/connections/model/adoptedSessionCommands";
import {
  requeueSharedLocalHead,
  sharedLocalQueueKept,
  wakeSharedLocalQueues,
} from "../../../../features/connections/model/useSharedLocalQueues";
import { sameQueueValue } from "../../../../features/connections/model/sharedQueue";
import { showSubmitNotice } from "./submitNotice";

/** Parks the submitted message in the conversation's queue: it is sent when the
 * conversation is free. A queue-row action already owns retained content, so it
 * leaves that row in place rather than appending a copy: the row stays queued and
 * the wait is a deferral (`QueueDeferredError`), not a refusal. */
export function queueSubmittedFollowUp(
  ctx: SubmitDeps,
  input: SubmitInput,
  pre: SubmitPreflight,
): SubmissionAcceptance {
  const { dismissNoticesForContinuedSession } = ctx;
  const { sessionId, text, attachments, options } = input;
  const { storedCurrent, intent, noteCard, handoffCard, rawCommand } = pre;
  if (options?.queuedMessageId)
    throw new QueueDeferredError(
      t("The conversation is busy. The queued message stays queued and sends when it is free."),
    );
  setSessions((prev) =>
    prev.map((s) =>
      s.id === sessionId
        ? appendQueuedMessage(
            {
              ...s,
              inboxCard: rawCommand ? s.inboxCard : undefined,
              noteCard: rawCommand ? s.noteCard : undefined,
              handoffCard: rawCommand ? s.handoffCard : undefined,
            },
            {
              id: crypto.randomUUID(),
              ...(storedCurrent.adoptedAuthorityGeneration !== undefined
                ? { authorityGeneration: storedCurrent.adoptedAuthorityGeneration }
                : {}),
              text,
              attachments,
              noteCard,
              handoffCard,
              intent,
              modelTarget: queuedModelTarget(options?.buildTarget ?? storedCurrent),
            },
          )
        : s,
    ),
  );
  dismissNoticesForContinuedSession(sessionId);
  return true;
}

/** Sessions whose queued head was put back after a provider refusal and must wait
 * with the queue's backoff before it is offered again (see takeRequeuedHeadSignal). */
const requeuedHeads = new Set<string>();

/** True once for a head put back by requeueQueuedRowHead; the queue hook then waits
 * with its capped backoff instead of re-offering the head at once. */
export function takeRequeuedHeadSignal(sessionId: string): boolean {
  return requeuedHeads.delete(sessionId);
}

/**
 * A queue row whose send the provider refused before any write (TurnNotReadyError)
 * goes back to the head of the queue with the same id, as the steer path restores it.
 * It is a wait, not an error: the queue is not held and no session error is shown.
 */
export function requeueQueuedRowHead(sessionId: string, input: SubmitInput, pre: SubmitPreflight) {
  const { storedCurrent } = pre;
  const messageId = input.options?.queuedMessageId;
  if (!messageId) return;
  requeuedHeads.add(sessionId);
  const original = storedCurrent.queuedMessages?.find((row) => row.id === messageId);
  const row = original ?? {
    id: messageId,
    text: input.text,
    attachments: input.attachments,
    noteCard: pre.noteCard,
    handoffCard: pre.handoffCard,
    intent: pre.intent,
    modelTarget: queuedModelTarget(storedCurrent),
  };
  // The shared queue writes the row back itself (under a new id, see requeueSharedLocalHead).
  if (requeueSharedLocalHead(sessionId, row)) return;
  // A window that keeps a shared queue but could not write now restores the row with a new
  // id too: the Host would drop the removed id on the next write, and the row with it.
  const restored = sharedLocalQueueKept(sessionId) ? { ...row, id: crypto.randomUUID() } : row;
  setSessions((prev) =>
    prev.map((entry) => {
      if (entry.id !== sessionId) return entry;
      return {
        ...entry,
        // Taking the last row off the queue cleared its status: a wait restores the
        // status it had (a paused or restored hold stays one), unless it changed since.
        queueStatus: entry.queueStatus ?? storedCurrent.queueStatus,
        queuedMessages: [
          restored,
          ...(entry.queuedMessages ?? []).filter((queued) => queued.id !== messageId),
        ],
      };
    }),
  );
  wakeSharedLocalQueues([sessionId]);
}

export function steerBusySubmit(
  ctx: SubmitDeps,
  input: SubmitInput,
  pre: SubmitPreflight,
): SubmissionAcceptance | undefined {
  const { dismissNoticesForContinuedSession } = ctx;
  const { turnGen } = ctx.refs;
  const { sessionId, text, attachments, options } = input;
  const {
    storedCurrent,
    current,
    intent,
    noteCard,
    handoffCard,
    initialWorkCwd,
    submittedText,
    operatorCommand,
    rawCommand,
    harnessText,
    pendingSwitch,
  } = pre;
  const queueFollowUp = (): SubmissionAcceptance => queueSubmittedFollowUp(ctx, input, pre);
  // Explicit Queue survives idle/handoff races; dispatching an existing row is separate.
  if (options?.followUpBehavior === "queue" && !options.queuedMessageId) return queueFollowUp();
  // A conflict never grows another branch. A host-owned run, however, accepts
  // ordinary follow-ups through that host rather than this desktop's provider.
  if (current.adoptedSyncConflict && !current.busy && !pendingSwitch) return queueFollowUp();
  if (current.continuingElsewhere && !current.busy && !pendingSwitch) {
    if (adoptedFollowUpPending(sessionId)) return queueFollowUp();
    if (
      options?.followUpBehavior === "queue" ||
      intent !== "default" ||
      rawCommand ||
      operatorCommand.matched ||
      noteCard ||
      handoffCard ||
      !canSteerHarness(current.harness)
    )
      return queueFollowUp();
    const messageId = options?.queuedMessageId ?? crypto.randomUUID();
    const progress = beginDeliveryProgress(sessionId, messageId, "preparing");
    const generation = turnGen.current.get(sessionId);
    const selected = options?.queuedMessageId
      ? storedCurrent.queuedMessages?.find((row) => row.id === options.queuedMessageId)
      : undefined;
    const authorityGeneration = options?.queuedMessageId
      ? selected?.authorityGeneration
      : storedCurrent.adoptedAuthorityGeneration;
    const retain = (unknown = false) =>
      setSessions((prev) =>
        prev.map((entry) =>
          entry.id === sessionId &&
          (!options?.queuedMessageId || entry.queuedMessages?.some((row) => row.id === messageId))
            ? holdUndeliveredFollowUp(entry, {
                id: messageId,
                ...(authorityGeneration !== undefined ? { authorityGeneration } : {}),
                text,
                attachments,
                intent,
                ...(unknown ? { deliveryUnknown: true as const } : {}),
                modelTarget: queuedModelTarget(storedCurrent),
              })
            : entry,
        ),
      );
    return (async () => {
      try {
        const accepted = await sendAdoptedFollowUp({
          sessionId,
          text,
          attachments,
          queuedMessageId: options?.queuedMessageId,
          authorityGeneration,
          isCurrent: () => {
            const latest = sessionsRef.current.find((entry) => entry.id === sessionId);
            return (
              turnGen.current.get(sessionId) === generation &&
              !!latest &&
              !latest.adoptedSyncConflict &&
              (!options?.queuedMessageId ||
                (!!selected &&
                  sameQueueValue(
                    latest.queuedMessages?.find((row) => row.id === selected.id),
                    selected,
                  ) &&
                  latest.queueStatus === storedCurrent.queueStatus &&
                  latest.editingQueuedMessageId === storedCurrent.editingQueuedMessageId))
            );
          },
          onDispatch: () => updateDeliveryProgress(sessionId, progress, "confirming"),
        });
        if (!accepted) {
          retain();
          updateDeliveryProgress(
            sessionId,
            progress,
            "rejected",
            t("The selected message or turn changed while waiting. The message remains queued."),
          );
          return false;
        }
        if (options?.queuedMessageId) {
          setSessions((prev) =>
            prev.map((entry) =>
              entry.id === sessionId &&
              sameQueueValue(
                entry.queuedMessages?.find((row) => row.id === options.queuedMessageId),
                selected,
              )
                ? sentQueuedMessage(entry, options.queuedMessageId!)
                : entry,
            ),
          );
          wakeSharedLocalQueues([sessionId]);
        }
        dismissNoticesForContinuedSession(sessionId);
        updateDeliveryProgress(sessionId, progress, "accepted");
        return true;
      } catch (error) {
        if (
          error instanceof QueueDeferredError &&
          turnGen.current.get(sessionId) === generation &&
          !sessionsRef.current.find((entry) => entry.id === sessionId)?.adoptedSyncConflict
        ) {
          clearDeliveryProgress(sessionId, progress);
          // A proven pre-write wait retains the owner's queue status. A queued
          // action releases its claim through the shared dispatcher's typed wait.
          return queueFollowUp();
        }
        const unknown = error instanceof DeliveryUnknownError;
        const detail = error instanceof Error ? error.message : String(error);
        retain(unknown);
        updateDeliveryProgress(sessionId, progress, unknown ? "unknown" : "rejected", detail);
        // onSubmit accepts deferred work immediately. Preserve every refusal,
        // including Stop during upload, before its cleared composer can lose it.
        return !options?.queuedMessageId;
      }
    })();
  }
  if (current.busy && !pendingSwitch) {
    if (
      operatorCommand.matched &&
      options?.queuedMessageId &&
      options.followUpBehavior === "steer"
    ) {
      showSubmitNotice(sessionId, "/operator starts a new turn after the current turn finishes.");
      return false;
    }
    // Background work may never end (a dev server), so ordinary Send steers.
    // Explicit Queue still waits for the current turn to finish.
    const followUpRoute = resolveFollowUpRoute({
      busy: true,
      worktreePreparing: current.worktreePreparing,
      intent,
      operatorCommand: operatorCommand.matched,
      backgroundTaskCount: current.backgroundTasks?.length ?? 0,
      backgroundOnly: isBackgroundOnly(
        !!current.busy,
        current.backgroundTasks,
        current.backgroundAgents,
      ),
      requested: options?.followUpBehavior,
    });
    // A native command (/goal, /review) must start its own turn; steering would
    // deliver it to the running turn as plain text.
    // A provider picked during this turn is for the next one; steer the turn's own.
    const running = runningTargetOf(current);
    if (followUpRoute === "queue" || rawCommand || !canSteerHarness(running.harness))
      return queueFollowUp();
    if (!isLiveHarness(running.harness) || !canSteerHarness(running.harness)) {
      // Harnesses that cannot steer (fx) used to drop the message on the
      // floor here, so a follow-up sent mid-turn just vanished. Say so.
      showSubmitNotice(
        sessionId,
        `${running.harness} cannot take a follow-up while a turn is running. Wait for it to finish or stop it first.`,
      );
      return false;
    }
    dismissNoticesForContinuedSession(sessionId);
    const visible = displayAttachments(attachments);
    const cards = userTurnCards(noteCard);
    const nextSessions = sessionsRef.current.map((s) => {
      if (s.id !== sessionId) return s;
      let next: Session = {
        ...s,
        inboxCard: rawCommand ? s.inboxCard : undefined,
        noteCard: rawCommand ? s.noteCard : undefined,
        handoffCard: rawCommand ? s.handoffCard : undefined,
      };
      if (options?.queuedMessageId) {
        next = sentQueuedMessage(next, options.queuedMessageId);
      }
      return appendSteerUser(next, submittedText, visible, cards);
    });
    sessionsRef.current = nextSessions;
    setSessions(nextSessions);
    const steerGeneration = turnGen.current.get(sessionId);
    const steerBlocks = nextSessions.find((entry) => entry.id === sessionId)?.blocks;
    const steerUserId = steerBlocks?.[steerBlocks.length - 1]?.id;
    const steerUserBlock = steerBlocks?.find((block) => block.id === steerUserId);
    const messageId = options?.queuedMessageId ?? steerUserId ?? crypto.randomUUID();
    const existingProgress = readDeliveryProgress(sessionId, messageId);
    const progress =
      existingProgress?.messageId === messageId
        ? existingProgress
        : beginDeliveryProgress(sessionId, messageId, "preparing");
    const holdFollowUp = (deliveryUnknown = false) =>
      setSessions((prev) =>
        prev.map((entry) =>
          entry.id === sessionId
            ? holdUndeliveredFollowUp(
                entry,
                {
                  id: messageId,
                  ...(deliveryUnknown ? { deliveryUnknown: true as const } : {}),
                  text,
                  attachments,
                  noteCard,
                  handoffCard,
                  intent,
                  modelTarget: queuedModelTarget(storedCurrent),
                },
                steerUserId,
              )
            : entry,
        ),
      );
    /** Puts a message that never reached the provider back in the queue, in its place. */
    const requeueUnwritten = (): boolean => {
      // The provider is not taking follow-ups right now: the turn has just
      // finished, or has not reached the provider yet. Either way the message
      // goes to the queue, ahead of anything queued after it when it came from
      // a queue row, and the wording does not claim which of the two it was.
      const fromRow = !!options?.queuedMessageId;
      setSessions((prev) =>
        prev.map((entry) => {
          if (entry.id !== sessionId) return entry;
          const cleaned = {
            ...entry,
            // Removing a restored row optimistically made it active. A wait
            // is not acceptance and must not release the remaining queue.
            ...(fromRow &&
            storedCurrent.queueStatus === "restored" &&
            entry.queueStatus === "active"
              ? { queueStatus: "restored" as const }
              : {}),
            blocks: entry.blocks.filter((block) => block.id !== steerUserId),
          };
          const row = storedCurrent.queuedMessages?.find((item) => item.id === messageId) ?? {
            id: messageId,
            text,
            attachments,
            noteCard,
            handoffCard,
            intent,
            modelTarget: queuedModelTarget(storedCurrent),
          };
          if (!fromRow || cleaned.queuedMessages?.some((item) => item.id === messageId))
            return appendQueuedMessage(cleaned, row);
          const original = storedCurrent.queuedMessages ?? [];
          const index = original.findIndex((item) => item.id === messageId);
          const following = new Set(original.slice(index + 1).map((item) => item.id));
          const queue = [...(cleaned.queuedMessages ?? [])];
          const before = queue.findIndex((item) => following.has(item.id));
          queue.splice(before < 0 ? queue.length : before, 0, row);
          return { ...cleaned, queuedMessages: queue };
        }),
      );
      const paused = sessionsRef.current.find((entry) => entry.id === sessionId)?.queueStatus;
      const note =
        paused === "paused" || paused === "restored"
          ? t(
              "The provider is not taking follow-ups right now. Your message is in the paused queue; resume the queue to send it.",
            )
          : t(
              "The provider is not taking follow-ups right now. Your message is queued and will be sent next.",
            );
      // No provider write happened. This is waiting work, not a rejected send.
      clearDeliveryProgress(sessionId, progress);
      wakeSharedLocalQueues([sessionId]);
      // Release a claimed row without accepting it or pausing the queue.
      if (options?.queuedMessageId) throw new QueueDeferredError(note);
      return true;
    };
    return (async () => {
      try {
        const prepared = await prepareAttachments(attachments);
        const prompt = await preparePrompt(harnessText, {
          harness: running.harness,
          sessionId,
          cwd: initialWorkCwd,
          delegation: { requestKey: submitDelegationKey(sessionId, options, current) },
        });
        // The turn ended or was replaced before the write. A user Stop pauses the
        // queue itself; this message keeps its place either way.
        if (turnGen.current.get(sessionId) !== steerGeneration) return requeueUnwritten();
        updateDeliveryProgress(sessionId, progress, "provider");
        markSharedProviderSend(sessionId);
        await steerHarnessTurn({
          onReady: () => updateDeliveryProgress(sessionId, progress, "confirming"),
          harness: running.harness,
          sessionId,
          cwd: initialWorkCwd,
          model: running.model,
          modelSettings: running.modelSettings,
          text: inboxAskPrompt(rawCommand ? undefined : current.inboxAsk, prompt),
          attachments: prepared,
        });
        updateDeliveryProgress(sessionId, progress, "accepted");
        return true;
      } catch (error: unknown) {
        if (error instanceof DeliveryUnknownError) {
          holdFollowUp(true);
          updateDeliveryProgress(
            sessionId,
            progress,
            "unknown",
            t(
              "Delivery is not confirmed. The message is held and will not be sent again automatically.",
            ),
          );
          // While the provider may still answer, the review does not offer "Send again".
          trackLateSettlement(sessionId, error.settlement);
          void error.settlement.then((result) => {
            if (result === "unknown") return;
            setSessions((prev) =>
              prev.map((entry) => {
                const held = entry.queuedMessages?.find((row) => row.id === messageId);
                const pendingProgress = readDeliveryProgress(sessionId, messageId);
                if (entry.id !== sessionId) return entry;
                const sameAttempt = pendingProgress?.operationId === progress.operationId;
                if (result === "accepted") {
                  // Actual acknowledgement is stronger evidence than a prior
                  // "keep queued" review. Do not replay the unchanged request.
                  const delivered =
                    held && sameAttempt ? sentQueuedMessage(entry, messageId) : entry;
                  return steerUserBlock &&
                    !delivered.blocks.some((block) => block.id === steerUserBlock.id)
                    ? { ...delivered, blocks: [...delivered.blocks, steerUserBlock] }
                    : delivered;
                }
                if (!held || !sameAttempt) return entry;
                return {
                  ...entry,
                  queueStatus: nextQueueStatus(entry.queueStatus, "reject"),
                  queuedMessages: entry.queuedMessages?.map((row) =>
                    row.id === messageId ? { ...row, deliveryUnknown: undefined } : row,
                  ),
                };
              }),
            );
            updateDeliveryProgress(
              sessionId,
              progress,
              result === "accepted" ? "accepted" : "rejected",
              result === "accepted"
                ? t("The provider confirmed delivery. The message was not sent again.")
                : t("The provider rejected the message. It remains queued and paused."),
            );
          });
          if (options?.queuedMessageId) throw error;
          return false;
        }
        // Nothing reached the provider: a wait, whichever turn now owns the session.
        if (error instanceof TurnNotReadyError) return requeueUnwritten();
        if (turnGen.current.get(sessionId) !== steerGeneration) {
          holdFollowUp();
          updateDeliveryProgress(
            sessionId,
            progress,
            "rejected",
            t("The turn was stopped. The message remains queued."),
          );
          return false;
        }
        const message =
          error instanceof Error
            ? error.message
            : `${running.harness} could not steer the active turn`;
        holdFollowUp();
        updateDeliveryProgress(sessionId, progress, "rejected", message);
        showSubmitNotice(
          sessionId,
          `${t("The follow-up could not be delivered. It is saved in the paused queue.")} ${message}`,
        );
        return false;
      }
    })();
  }
}
