import type { SubmitDeps, SubmitInput } from "./submitTypes";

import { remoteProjectFor } from "../../../../features/connections/model/remoteProjects";
import { remoteSessionActions } from "../../../../features/connections/model/remoteSessionActions";
import { sharedLocalQueueClaiming, submitSharedLocalQueue } from "../../../../features/connections/model/useSharedLocalQueues";
import { sessionsRef } from "../../../../features/sessions/model/sessionsStore";
import { parseShellCommand } from "../../../../features/sessions/model/shellRun";
import { type SubmissionAcceptance } from "../../../model/submissionAcceptance";

export function routeSubmitSession(ctx: SubmitDeps, input: SubmitInput): SubmissionAcceptance | undefined {
  const { getSubmitSessionRef, runSessionShell } = ctx;
  const { windowTransferPendingRef, movingSessionIds, editedResends, retiringTurns, turnGen } = ctx.refs;
  const { sessionId, text, attachments, options } = input;
  // Preserve composer text while this session is handed to another window.
  // Other sessions remain usable throughout the move.
  if (windowTransferPendingRef.current || movingSessionIds.current.has(sessionId)) return false;
  if (editedResends.isActive(sessionId)) return false;
  if (retiringTurns.current.has(sessionId)) return false;
  if (sessionsRef.current.some((session) => session.id === sessionId && session.historyLoading))
    return false;
  const remote = sessionsRef.current.find((session) => session.id === sessionId);
  if (remote && remoteProjectFor(remote.cwd))
    return !!remoteSessionActions(sessionId)?.submit(text, attachments, options);
  if (sharedLocalQueueClaiming(sessionId) && !options?.sharedQueueClaimed) return false;
  if (options?.queuedMessageId && !options.sharedQueueClaimed) {
    const queuedGeneration = turnGen.current.get(sessionId);
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
          latest?.queuedMessages === remote?.queuedMessages &&
          latest?.queueStatus === remote?.queueStatus &&
          latest?.editingQueuedMessageId === remote?.editingQueuedMessageId
        );
      },
    );
  }
  // `!command` typed in the composer runs in the shell; it is not a turn,
  // so nothing below about queues, drafts or a busy session applies.
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
  if (shellCommand) return runSessionShell(sessionId, shellCommand);
}

