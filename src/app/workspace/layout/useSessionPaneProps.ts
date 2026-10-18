import { useMemo } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { leafIds, type WorkspaceTab } from "../../../features/workspace/model/layout";
import type { ActiveWorkspaceContext } from "../derived/useActiveWorkspaceContext";
import type { useWorkspaceNavigation } from "../../hooks/useWorkspaceNavigation";
import type { useMovingWindowsState } from "../windows/useWindowTransferState";
import type { useProjectState } from "../state/useProjectState";
import type { WorkspaceSessionPaneProps } from "./WorkspaceMainArea";

type P = WorkspaceSessionPaneProps;

export interface SessionPaneDeps {
  onKeepSession: (sessionId: string) => void;
  tabs: WorkspaceTab[];
  movingWindows: ReturnType<typeof useMovingWindowsState>["movingWindows"];
  windowTransferPending: boolean;
  workspaceNavigation: Pick<ReturnType<typeof useWorkspaceNavigation>, "pending">;
  active: ActiveWorkspaceContext["active"];
  visibleRecents: ReturnType<typeof useProjectState>["visibleRecents"];
  onFocusPane: P["onFocus"];
  onClosePane: P["onClose"];
  onCwdChange: P["onCwdChange"];
  onBranchChange: P["onBranchChange"];
  onComposerWorktreeChange: P["onWorktreeChange"];
  onRemoteSnapshot: P["onRemoteSnapshot"];
  onRefreshAdoptedSession: P["onRefreshAdoptedSession"];
  onWorkspaceModeChange: P["onWorkspaceModeChange"];
  onWorktreeBaseChange: P["onWorktreeBaseChange"];
  onManageWorktrees: P["onManageWorktrees"];
  onModelChange: P["onModelChange"];
  onModelSettingsChange: P["onModelSettingsChange"];
  onRuntimeModeChange: P["onRuntimeModeChange"];
  onSaveDraft: P["onSaveDraft"];
  onRemoveDraft: P["onRemoveDraft"];
  onSubmit: P["onSubmit"];
  onStop: P["onStop"];
  onRewindMessage: P["onRewindMessage"];
  onCompactContext: P["onCompactContext"];
  onNewSession: P["onNewSession"];
  onPlaceSessionInFolder: P["onPlaceSessionInFolder"];
  onResumeProviderSession: P["onResumeProviderSession"];
  onDeleteQueuedMessage: P["onDeleteQueuedMessage"];
  onEditQueuedMessage: P["onEditQueuedMessage"];
  onQueuedMessageEditingChange: P["onQueuedMessageEditingChange"];
  onReorderQueuedMessages: P["onReorderQueuedMessages"];
  onSteerQueuedMessage: P["onSteerQueuedMessage"];
  onResumeQueue: P["onResumeQueue"];
  onUsageLimitResume: P["onUsageLimitResume"];
  onUsageLimitResumeAtReset: P["onUsageLimitResumeAtReset"];
  onUsageLimitDismiss: P["onUsageLimitDismiss"];
  onSwitchSessionAccount: P["onSelectProviderAccount"];
  onInboxCardDismiss: P["onInboxCardDismiss"];
  onLinkedWorkItemUpdateCardDismiss: P["onLinkedWorkItemUpdateCardDismiss"];
  onNoteCardDismiss: P["onNoteCardDismiss"];
  onHandoffCardDismiss: P["onHandoffCardDismiss"];
  onOpenLinkedWorkItem: P["onOpenLinkedWorkItem"];
  onArchiveHistorySession: P["onArchiveSession"];
  onDeleteHistorySession: P["onDeleteSession"];
  onApproval: P["onApproval"];
  onQuestionReply: P["onQuestionReply"];
  onQuestionInteraction: P["onQuestionInteraction"];
  onOpenFile: P["onOpenFile"];
  onOpenDiff: P["onOpenDiff"];
  onOpenPlan: P["onOpenPlan"];
  onBuildPlan: P["onBuildPlan"];
  onSecondOpinion: P["onSecondOpinion"];
  onHandoff: P["onHandoff"];
  onBtwSubmit: P["onBtwSubmit"];
  onBtwRetry: P["onBtwRetry"];
  onBtwDelete: P["onBtwDelete"];
  onBtwStop: P["onBtwStop"];
  onBtwModelChange: P["onBtwModelChange"];
  onNewTerminalInSession: P["onNewTerminal"];
  onRunSessionProjectAction: P["onRunProjectAction"];
}

export function useSessionPaneProps({
  onKeepSession,
  tabs,
  movingWindows,
  windowTransferPending,
  workspaceNavigation,
  active,
  visibleRecents,
  onFocusPane,
  onClosePane,
  onCwdChange,
  onBranchChange,
  onComposerWorktreeChange,
  onRemoteSnapshot,
  onRefreshAdoptedSession,
  onWorkspaceModeChange,
  onWorktreeBaseChange,
  onManageWorktrees,
  onModelChange,
  onModelSettingsChange,
  onRuntimeModeChange,
  onSaveDraft,
  onRemoveDraft,
  onSubmit,
  onStop,
  onRewindMessage,
  onCompactContext,
  onNewSession,
  onPlaceSessionInFolder,
  onResumeProviderSession,
  onDeleteQueuedMessage,
  onEditQueuedMessage,
  onQueuedMessageEditingChange,
  onReorderQueuedMessages,
  onSteerQueuedMessage,
  onResumeQueue,
  onUsageLimitResume,
  onUsageLimitResumeAtReset,
  onUsageLimitDismiss,
  onSwitchSessionAccount,
  onInboxCardDismiss,
  onLinkedWorkItemUpdateCardDismiss,
  onNoteCardDismiss,
  onHandoffCardDismiss,
  onOpenLinkedWorkItem,
  onArchiveHistorySession,
  onDeleteHistorySession,
  onApproval,
  onQuestionReply,
  onQuestionInteraction,
  onOpenFile,
  onOpenDiff,
  onOpenPlan,
  onBuildPlan,
  onSecondOpinion,
  onHandoff,
  onBtwSubmit,
  onBtwRetry,
  onBtwDelete,
  onBtwStop,
  onBtwModelChange,
  onNewTerminalInSession,
  onRunSessionProjectAction,
}: SessionPaneDeps) {
  const windowMovingSessionIds = useMemo(
    () =>
      new Set(
        tabs
          .filter((tab) => windowTransferPending || movingWindows.has(tab.id))
          .flatMap((tab) => leafIds(tab.layout)),
      ),
    [tabs, movingWindows, windowTransferPending],
  );
  const sessionPaneProps = {
    windowMovingSessionIds,
    workspaceSwitchingSessionId: workspaceNavigation.pending ? active?.id : undefined,
    recents: visibleRecents,
    hideProjectPicker: true,
    onFocus: onFocusPane,
    onSessionInteraction: onKeepSession,
    onClose: onClosePane,
    onCwdChange: useKeepSessionAction(onCwdChange, onKeepSession)!,
    onBranchChange: useKeepSessionAction(onBranchChange, onKeepSession)!,
    onWorktreeChange: onComposerWorktreeChange,
    onRemoteSnapshot,
    onRefreshAdoptedSession,
    onWorkspaceModeChange: useKeepSessionAction(onWorkspaceModeChange, onKeepSession)!,
    onWorktreeBaseChange,
    onManageWorktrees,
    onModelChange: useKeepSessionAction(onModelChange, onKeepSession)!,
    onModelSettingsChange: useKeepSessionAction(onModelSettingsChange, onKeepSession)!,
    onRuntimeModeChange: useKeepSessionAction(onRuntimeModeChange, onKeepSession)!,
    onSaveDraft: useKeepSessionAction(onSaveDraft, onKeepSession)!,
    onRemoveDraft: useKeepSessionAction(onRemoveDraft, onKeepSession)!,
    onSubmit: useKeepSessionAction(onSubmit, onKeepSession)!,
    onStop: useKeepSessionAction(onStop, onKeepSession)!,
    onRewindMessage: useKeepSessionAction(onRewindMessage, onKeepSession)!,
    onCompactContext: useKeepSessionAction(onCompactContext, onKeepSession)!,
    onNewSession,
    onPlaceSessionInFolder,
    onResumeProviderSession: useKeepSessionAction(onResumeProviderSession, onKeepSession)!,
    onDeleteQueuedMessage: useKeepSessionAction(onDeleteQueuedMessage, onKeepSession)!,
    onEditQueuedMessage: useKeepSessionAction(onEditQueuedMessage, onKeepSession)!,
    onQueuedMessageEditingChange,
    onReorderQueuedMessages: useKeepSessionAction(onReorderQueuedMessages, onKeepSession)!,
    onSteerQueuedMessage: useKeepSessionAction(onSteerQueuedMessage, onKeepSession)!,
    onResumeQueue: useKeepSessionAction(onResumeQueue, onKeepSession)!,
    onUsageLimitResume,
    onUsageLimitResumeAtReset,
    onUsageLimitDismiss,
    onSelectProviderAccount: onSwitchSessionAccount,
    onInboxCardDismiss,
    onLinkedWorkItemUpdateCardDismiss,
    onNoteCardDismiss,
    onHandoffCardDismiss,
    onOpenLinkedWorkItem,
    onArchiveSession: onArchiveHistorySession,
    onDeleteSession: onDeleteHistorySession,
    onApproval: useKeepSessionAction(onApproval, onKeepSession)!,
    onQuestionReply: useKeepSessionAction(onQuestionReply, onKeepSession)!,
    onQuestionInteraction: useKeepSessionAction(onQuestionInteraction, onKeepSession),
    onOpenFile,
    onOpenDiff,
    onOpenPlan,
    onBuildPlan: useKeepSessionAction(onBuildPlan, onKeepSession)!,
    onSecondOpinion: useKeepSessionAction(onSecondOpinion, onKeepSession)!,
    onHandoff: useKeepSessionAction(onHandoff, onKeepSession)!,
    onBtwSubmit: useKeepSessionAction(onBtwSubmit, onKeepSession),
    onBtwRetry: useKeepSessionAction(onBtwRetry, onKeepSession),
    onBtwDelete: useKeepSessionAction(onBtwDelete, onKeepSession),
    onBtwStop: useKeepSessionAction(onBtwStop, onKeepSession),
    onBtwModelChange: useKeepSessionAction(onBtwModelChange, onKeepSession),
    onNewTerminal: onNewTerminalInSession,
    onRunProjectAction: onRunSessionProjectAction,
  };

  return { sessionPaneProps };
}

/** Preserve callback identity and optionality while committing intentional session actions. */
function useKeepSessionAction<A extends unknown[], R>(
  action: ((id: string, ...args: A) => R) | undefined,
  keep: (id: string) => void,
): ((id: string, ...args: A) => R) | undefined {
  return useStableCallback(
    action
      ? (id: string, ...args: A) => {
          keep(id);
          return action(id, ...args);
        }
      : undefined,
  );
}
