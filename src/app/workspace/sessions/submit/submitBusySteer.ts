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
  sentQueuedMessage,
} from "../../../../features/sessions/model/messageQueue";
import { preparePrompt } from "../../../../features/sessions/model/promptPreparation";
import { type Session } from "../../../../features/sessions/model/session";
import { sessionsRef, setSessions } from "../../../../features/sessions/model/sessionsStore";
import {
  appendSteerUser,
  canSteerHarness,
  isLiveHarness,
  steerHarnessTurn,
} from "../../../../integrations/harness";
import { t } from "../../../../shared/i18n";
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
import { wakeSharedLocalQueues } from "../../../../features/connections/model/useSharedLocalQueues";
import { sameQueueValue } from "../../../../features/connections/model/sharedQueue";

/** Parks the submitted message in the conversation's queue: it is sent when the
 * conversation is free. A queue-row action already owns retained content, so it
 * leaves that row in place rather than appending a copy. */
export function queueSubmittedFollowUp(
  ctx: SubmitDeps,
  input: SubmitInput,
  pre: SubmitPreflight,
): SubmissionAcceptance {
  const { dismissNoticesForContinuedSession } = ctx;
  const { sessionId, text, attachments, options } = input;
  const { storedCurrent, intent, noteCard, handoffCard, rawCommand } = pre;
  if (options?.queuedMessageId) return false;
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

export function steerBusySubmit(
  ctx: SubmitDeps,
  input: SubmitInput,
  pre: SubmitPreflight,
): SubmissionAcceptance | undefined {
  const { dismissNoticesForContinuedSession, enqueueHarnessEvent, flushHarnessEvents } = ctx;
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
  // A conflict never grows another branch. A host-owned run, however, accepts
  // ordinary follow-ups through that host rather than this desktop's provider.
  if (current.adoptedSyncConflict && !current.busy && !pendingSwitch) return queueFollowUp();
  if (current.continuingElsewhere && !current.busy && !pendingSwitch) {
    if (adoptedFollowUpPending(sessionId)) return false;
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
    const retain = (unknown = false) =>
      setSessions((prev) =>
        prev.map((entry) =>
          entry.id === sessionId &&
          (!options?.queuedMessageId || entry.queuedMessages?.some((row) => row.id === messageId))
            ? holdUndeliveredFollowUp(entry, {
                id: messageId,
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
      enqueueHarnessEvent(sessionId, {
        type: "status",
        text: "/operator starts a new turn after the current turn finishes.",
      });
      flushHarnessEvents();
      return false;
    }
    // Background work with the agent yielded may never end (a dev
    // server), so there the message is steered instead of parked behind it.
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
    if (followUpRoute === "queue" || rawCommand || !canSteerHarness(current.harness))
      return queueFollowUp();
    if (!isLiveHarness(current.harness) || !canSteerHarness(current.harness)) {
      // Harnesses that cannot steer (fx) used to drop the message on the
      // floor here, so a follow-up sent mid-turn just vanished. Say so.
      enqueueHarnessEvent(sessionId, {
        type: "status",
        text: `${current.harness} cannot take a follow-up mid-turn — wait for this turn to finish, or stop it first.`,
      });
      flushHarnessEvents();
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
    return (async () => {
      try {
        const prepared = await prepareAttachments(attachments);
        const prompt = await preparePrompt(harnessText, {
          harness: current.harness,
          sessionId,
          cwd: initialWorkCwd,
        });
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
        updateDeliveryProgress(sessionId, progress, "provider");
        markSharedProviderSend(sessionId);
        await steerHarnessTurn({
          onReady: () => updateDeliveryProgress(sessionId, progress, "confirming"),
          harness: current.harness,
          sessionId,
          cwd: initialWorkCwd,
          model: current.model,
          modelSettings: current.modelSettings,
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
            : `${current.harness} could not steer the active turn`;
        holdFollowUp();
        updateDeliveryProgress(sessionId, progress, "rejected", message);
        enqueueHarnessEvent(sessionId, {
          type: "status",
          text: `${t("The follow-up could not be delivered. It is saved in the paused queue.")} ${message}`,
        });
        flushHarnessEvents();
        return false;
      }
    })();
  }
}
