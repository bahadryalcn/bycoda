import type { SubmitDeps, SubmitInput } from "./submitTypes";
import { hostSessionBinding } from "../../../../features/connections/model/sessionExecutionBinding";

import { remoteProjectFor } from "../../../../features/connections/model/remoteProjects";
import { remoteSessionActions } from "../../../../features/connections/model/remoteSessionActions";
import {
  sharedLocalQueueClaiming,
  submitSharedLocalQueue,
} from "../../../../features/connections/model/useSharedLocalQueues";
import { sessionsRef } from "../../../../features/sessions/model/sessionsStore";
import { t } from "../../../../shared/i18n";
import { showSubmitNotice } from "./submitNotice";
import { prepareSubmitPreflight } from "./submitPreflight";
import { queueWhileStarting } from "./submitStarting";
import { parseShellCommand } from "../../../../features/sessions/model/shellRun";
import { isClearSessionCommand } from "../../../../features/sessions/model/newSessionCommand";
import { submitClearConversation } from "./submitClearConversation";
import { type SubmissionAcceptance } from "../../../model/submissionAcceptance";
import { sameQueueValue } from "../../../../features/connections/model/sharedQueue";
import { ADOPTED_RUNNING_REASON } from "../../../../features/connections/model/adoptedSessions";
import { adoptedFollowUpPending } from "../../../../features/connections/model/adoptedSessionCommands";

export function routeSubmitSession(
  ctx: SubmitDeps,
  input: SubmitInput,
): SubmissionAcceptance | undefined {
  const { getSubmitSessionRef, runSessionShell } = ctx;
  const { windowTransferPendingRef, movingSessionIds, editedResends, retiringTurns, turnGen } =
    ctx.refs;
  const { sessionId, text, attachments, options } = input;
  // A send that cannot start says why, as a notice that stays in the transcript
  // (a status line folds into the running turn); the composer keeps the text.
  const refuse = (reason: string): false => {
    showSubmitNotice(sessionId, reason);
    return false;
  };
  if (adoptedFollowUpPending(sessionId)) {
    // The previous follow-up may still be uploading its attachments. This one
    // waits in the queue instead of being refused, and goes out after it.
    const early = prepareSubmitPreflight(ctx, input);
    if (early.settled) return early.value;
    return queueWhileStarting(
      ctx,
      input,
      early.pre,
      t("The previous follow-up is still being delivered. Send again in a moment."),
      t(
        "The previous follow-up is still being delivered. Your message stays queued and will be sent when it finishes.",
      ),
    );
  }
  // Preserve composer text while this session is handed to another window.
  // Other sessions remain usable throughout the move.
  if (windowTransferPendingRef.current || movingSessionIds.current.has(sessionId))
    return refuse(t("This conversation is being moved to another window. Send again in a moment."));
  if (editedResends.isActive(sessionId))
    return refuse(t("This conversation is being changed. Send again in a moment."));
  if (retiringTurns.current.has(sessionId)) {
    // The failed turn is still being cleaned up (its process, its checkpoint).
    // The message waits in the queue and goes out when the conversation is free.
    const early = prepareSubmitPreflight(ctx, input);
    if (early.settled) return early.value;
    return queueWhileStarting(
      ctx,
      input,
      early.pre,
      t("The previous turn is still being cleaned up. Send again in a moment."),
      t(
        "The previous turn is still being cleaned up. Your message stays queued and will be sent when it finishes.",
      ),
    );
  }
  const loading = sessionsRef.current.find(
    (session) => session.id === sessionId && session.historyLoading,
  );
  if (loading)
    return refuse(
      loading.historyLoadError
        ? t("Earlier messages could not be loaded. Reopen this chat to retry.")
        : t("This conversation is still loading. Send again in a moment."),
    );
  const remote = sessionsRef.current.find((session) => session.id === sessionId);
  if (remote && (hostSessionBinding(remote) || remoteProjectFor(remote.cwd))) {
    const actions = remoteSessionActions(sessionId);
    if (!actions)
      return refuse(
        t("The computer that runs this conversation is not connected. Your message is kept."),
      );
    return !!actions.submit(text, attachments, options);
  }
  if (sharedLocalQueueClaiming(sessionId) && !options?.sharedQueueClaimed)
    return refuse(t("A queued message is being sent. Send again in a moment."));
  if (options?.queuedMessageId && !options.sharedQueueClaimed && !remote?.continuingElsewhere) {
    const queuedGeneration = turnGen.current.get(sessionId);
    const selected = remote?.queuedMessages?.find(
      (message) => message.id === options.queuedMessageId,
    );
    return submitSharedLocalQueue(
      sessionId,
      options.queuedMessageId,
      options.followUpBehavior === "steer",
      (message) =>
        getSubmitSessionRef().current(
          sessionId,
          message?.text ?? text,
          message?.attachments ?? attachments,
          { ...options, sharedQueueClaimed: true },
        ),
      () => {
        const latest = sessionsRef.current.find((session) => session.id === sessionId);
        return (
          turnGen.current.get(sessionId) === queuedGeneration &&
          !!latest &&
          !!selected &&
          sameQueueValue(
            latest.queuedMessages?.find((message) => message.id === options.queuedMessageId),
            selected,
          ) &&
          latest?.queueStatus === remote?.queueStatus &&
          latest?.editingQueuedMessageId === remote?.editingQueuedMessageId
        );
      },
    );
  }
  // `!command` typed in the composer runs in the shell; it is not a turn,
  // so nothing below about queues, drafts or a busy session applies.
  if (
    isClearSessionCommand(text) &&
    !options?.managed &&
    !options?.queuedMessageId &&
    !options?.draftBlockId &&
    !options?.resendEdited &&
    !options?.appRequestId &&
    !options?.ciRepair
  )
    return submitClearConversation(ctx, sessionId);
  const shellCommand =
    attachments.length === 0 &&
    !options?.managed &&
    !options?.queuedMessageId &&
    !options?.draftBlockId &&
    !options?.resendEdited &&
    !options?.appRequestId &&
    !options?.ciRepair &&
    (options?.intent ?? "default") === "default"
      ? parseShellCommand(text)
      : undefined;
  if (shellCommand) {
    // Its output joins the transcript the host is still writing.
    if (remote?.continuingElsewhere && !remote.busy) {
      return refuse(ADOPTED_RUNNING_REASON);
    }
    return runSessionShell(sessionId, shellCommand);
  }
}
