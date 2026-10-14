import type { ComponentProps, Dispatch, SetStateAction } from "react";
import { QuickDeleteWorktreeDialog } from "../../../features/source-control/ui/QuickDeleteWorktreeDialog";
import type { WorktreeManagementRequest } from "../../../features/source-control/model/worktreeManagement";
import { SettingsView } from "../surfaces/lazySurfaces";

type SettingsProps = ComponentProps<typeof SettingsView>;
type QuickDeleteProps = ComponentProps<typeof QuickDeleteWorktreeDialog>;

export interface WorkspaceSettingsSurfaceProps {
  // Worktree management dialog
  worktreeManagementRequest: QuickDeleteProps["request"] | null;
  worktreeManagementRevision: number;
  setWorktreeManagementRequest: Dispatch<SetStateAction<WorktreeManagementRequest | null>>;
  onRemoveWorktree: QuickDeleteProps["onRemove"];
  // Settings view
  settingsOpen: boolean;
  settingsSection: SettingsProps["section"];
  settingsAnchor: SettingsProps["anchor"];
  notificationProjectPath: SettingsProps["notificationProjectPath"];
  notificationSettingsRequest: SettingsProps["notificationSettingsRequest"];
  visibleRecents: SettingsProps["recents"];
  sidebarCwd: SettingsProps["cwd"];
  sidebarHistory: SettingsProps["sessions"];
  sessions: SettingsProps["liveSessions"];
  onCheckWorktreeRemoval: SettingsProps["onCheckWorktreeRemoval"];
  onDeleteWorktreeSessions: SettingsProps["onDeleteWorktreeSessions"];
  onCloseSettings: SettingsProps["onClose"];
  onSelectSettingsSection: SettingsProps["onSelectSection"];
  onOpenArchivedSession: SettingsProps["onOpenSession"];
  onArchiveHistorySession: SettingsProps["onArchiveSession"];
  onDeleteHistorySession: SettingsProps["onDeleteSession"];
  onRestoreProject: SettingsProps["onRestoreProject"];
  onRemoveProject: (path: string, options: { purgeData: boolean }) => Promise<void>;
  onOpenWhatsNew: SettingsProps["onOpenWhatsNew"];
  collapsedProjectRailMode: SettingsProps["collapsedProjectRailMode"];
  setCollapsedProjectRailMode: SettingsProps["onCollapsedProjectRailModeChange"];
}

export function WorkspaceSettingsSurface({
  worktreeManagementRequest,
  worktreeManagementRevision,
  setWorktreeManagementRequest,
  onRemoveWorktree,
  settingsOpen,
  settingsSection,
  settingsAnchor,
  notificationProjectPath,
  notificationSettingsRequest,
  visibleRecents,
  sidebarCwd,
  sidebarHistory,
  sessions,
  onCheckWorktreeRemoval,
  onDeleteWorktreeSessions,
  onCloseSettings,
  onSelectSettingsSection,
  onOpenArchivedSession,
  onArchiveHistorySession,
  onDeleteHistorySession,
  onRestoreProject,
  onRemoveProject,
  onOpenWhatsNew,
  collapsedProjectRailMode,
  setCollapsedProjectRailMode,
}: WorkspaceSettingsSurfaceProps) {
  return (
    <>
      {worktreeManagementRequest ? (
        <QuickDeleteWorktreeDialog
          key={worktreeManagementRevision}
          request={worktreeManagementRequest}
          onRemove={onRemoveWorktree}
          onClose={() => setWorktreeManagementRequest(null)}
        />
      ) : null}
      {settingsOpen ? (
        <SettingsView
          section={settingsSection}
          anchor={settingsAnchor}
          notificationProjectPath={notificationProjectPath}
          notificationSettingsRequest={notificationSettingsRequest}
          recents={visibleRecents}
          cwd={sidebarCwd}
          sessions={sidebarHistory}
          liveSessions={sessions}
          onRemoveWorktree={onRemoveWorktree}
          onCheckWorktreeRemoval={onCheckWorktreeRemoval}
          onDeleteWorktreeSessions={onDeleteWorktreeSessions}
          onClose={onCloseSettings}
          onSelectSection={onSelectSettingsSection}
          onOpenSession={onOpenArchivedSession}
          onArchiveSession={onArchiveHistorySession}
          onDeleteSession={onDeleteHistorySession}
          onRestoreProject={onRestoreProject}
          onDeleteProject={(path) => onRemoveProject(path, { purgeData: true })}
          onOpenWhatsNew={onOpenWhatsNew}
          collapsedProjectRailMode={collapsedProjectRailMode}
          onCollapsedProjectRailModeChange={setCollapsedProjectRailMode}
        />
      ) : null}
    </>
  );
}
