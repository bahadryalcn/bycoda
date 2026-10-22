import type { Session } from "./session";

export function canClearConversation(session: Session): boolean {
  return !(
    session.busy ||
    session.continuingElsewhere ||
    session.historyLoading ||
    session.historyPartial ||
    session.adoptedSyncConflict ||
    session.worktreePreparing ||
    session.orchestrationLeadId ||
    session.automationId ||
    session.pendingQuestion ||
    session.editingQueuedMessageId ||
    (session.queuedMessages?.length ?? 0) > 0 ||
    session.blocks.some((block) => block.approval && !block.approval.decided)
  );
}

/** Keep the workspace and settings, but retain no conversation or replay source. */
export function clearConversation(session: Session): Session {
  return {
    ...session,
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
