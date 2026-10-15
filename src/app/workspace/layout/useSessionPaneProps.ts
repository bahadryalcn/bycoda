import { useMemo } from "react";
import { leafIds, type WorkspaceTab } from "../../../features/workspace/model/layout";
import type { ActiveWorkspaceContext } from "../derived/useActiveWorkspaceContext";
import type { useWorkspaceNavigation } from "../../hooks/useWorkspaceNavigation";
import type { useMovingWindowsState } from "../windows/useWindowTransferState";
import type { useProjectState } from "../state/useProjectState";
import type { WorkspaceSessionPaneProps } from "./WorkspaceMainArea";

type P = WorkspaceSessionPaneProps;

export interface SessionPaneDeps {
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
    onClose: onClosePane,
    onCwdChange,
    onBranchChange,
    onWorktreeChange: onComposerWorktreeChange,
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
    onSelectProviderAccount: onSwitchSessionAccount,
    onInboxCardDismiss,
    onLinkedWorkItemUpdateCardDismiss,
    onNoteCardDismiss,
    onHandoffCardDismiss,
    onOpenLinkedWorkItem,
    onArchiveSession: onArchiveHistorySession,
    onDeleteSession: onDeleteHistorySession,
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
    onNewTerminal: onNewTerminalInSession,
    onRunProjectAction: onRunSessionProjectAction,
  };

  return { sessionPaneProps };
}
