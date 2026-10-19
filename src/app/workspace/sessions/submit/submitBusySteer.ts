import type { SubmitDeps, SubmitInput, SubmitPreflight } from "./submitTypes";

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
    if (followUpRoute === "queue" || rawCommand || !canSteerHarness(current.harness)) {
      // A queue-row action already owns retained content. Falling back to
      // the queue must leave that row in place rather than append a copy.
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
    const holdFollowUp = () =>
      setSessions((prev) =>
        prev.map((entry) =>
          entry.id === sessionId
            ? holdUndeliveredFollowUp(
                entry,
                {
                  id: options?.queuedMessageId ?? crypto.randomUUID(),
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
          return false;
        }
        await steerHarnessTurn({
          harness: current.harness,
          sessionId,
          cwd: initialWorkCwd,
          model: current.model,
          modelSettings: current.modelSettings,
          text: inboxAskPrompt(rawCommand ? undefined : current.inboxAsk, prompt),
          attachments: prepared,
        });
        return true;
      } catch (error: unknown) {
        if (turnGen.current.get(sessionId) !== steerGeneration) {
          holdFollowUp();
          return false;
        }
        const message =
          error instanceof Error
            ? error.message
            : `${current.harness} could not steer the active turn`;
        holdFollowUp();
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
