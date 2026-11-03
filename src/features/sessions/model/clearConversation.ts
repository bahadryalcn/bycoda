import { t } from "../../../shared/i18n/core";
import type { Session } from "./session";

/** Why `/clear` cannot run now, in words for the person; undefined when it can. */
export function clearConversationBlocker(session: Session): string | undefined {
  if (session.busy) return t("Stop the current turn before clearing the conversation.");
  if (session.continuingElsewhere)
    return t(
      "The bycoda Host is running this conversation. Wait for it to finish before clearing.",
    );
  if (session.historyLoading || session.historyPartial)
    return t("The conversation is still loading. Clear it once it has loaded.");
  if (session.adoptedSyncConflict)
    return t("This conversation has a sync conflict. Resolve it before clearing.");
  if (session.worktreePreparing)
    return t("The workspace is still being prepared. Clear the conversation afterwards.");
  if (session.orchestrationLeadId || session.automationId)
    return t("This conversation belongs to an orchestration or automation and cannot be cleared.");
  if (session.pendingQuestion)
    return t("Answer the open question before clearing the conversation.");
  if (session.editingQueuedMessageId)
    return t("Finish editing the queued message before clearing the conversation.");
  if ((session.queuedMessages?.length ?? 0) > 0)
    return t("Send or delete the queued messages before clearing the conversation.");
  if (session.blocks.some((block) => block.approval && !block.approval.decided))
    return t("Decide the pending approval before clearing the conversation.");
  return undefined;
}

export function canClearConversation(session: Session): boolean {
  return clearConversationBlocker(session) === undefined;
}

/** Keep the workspace and settings, but retain no conversation or replay source. */
export function clearConversation(session: Session): Session {
  return {
    ...session,
    // Migrate established legacy execution identity before removing its evidence.
    // This persisted choice survives an empty transcript and application restart.
    workspaceMode:
      session.workspaceMode ??
      (!session.worktreeCwd &&
      !session.workspaceId &&
      (session.blocks.some((block) => block.role === "user") || session.rewindHistory?.length)
        ? "current"
        : undefined),
    blocks: [],
    providerSessionId: undefined,
    pendingSwitch: undefined,
    pendingContextReplay: undefined,
    rewindHistory: undefined,
    rewindHistoryTruncated: undefined,
    context: undefined,
    usage: undefined,
    usageLimit: undefined,
    retryMessage: undefined,
    pendingQuestion: undefined,
    submittedQuestions: undefined,
    queuedMessages: [],
    queueStatus: undefined,
    editingQueuedMessageId: undefined,
    backgroundTasks: undefined,
    backgroundAgents: undefined,
    runningModelTarget: undefined,
    composerSeed: undefined,
    noteCard: undefined,
    handoffCard: undefined,
    inboxCard: undefined,
    linkedWorkItemUpdateCard: undefined,
  };
}
