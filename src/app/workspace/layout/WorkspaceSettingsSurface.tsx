import { Suspense, memo, useCallback, useMemo, useState } from "react";
import { useStableHandlers } from "../../../shared/hooks/useStableHandlers";
import type { ComponentProps, Dispatch, SetStateAction } from "react";
import { QuickDeleteWorktreeDialog } from "../../../features/source-control/ui/QuickDeleteWorktreeDialog";
import { WorktreesPage } from "../../../features/source-control/ui/WorktreesPage";
import { Modal } from "../../../shared/ui/Modal";
import { t, useLocale } from "../../../shared/i18n/git";
import type { WorktreeManagementRequest } from "../../../features/source-control/model/worktreeManagement";
import { SettingsView } from "../surfaces/lazySurfaces";
import { settingsSectionPresentation } from "../../../features/settings/model/settings";
import "./WorkspaceSettingsSurface.css";
import { NavigationBoundary } from "../../shell/NavigationBoundary";
import { RecoveryBoundary } from "../../../shared/ui/RecoveryBoundary";
import { LoaderCircle } from "../../../shared/ui/icons";

type SettingsProps = ComponentProps<typeof SettingsView>;
type QuickDeleteProps = ComponentProps<typeof QuickDeleteWorktreeDialog>;

/**
 * `page` replaces the workspace area with Settings (the owner of that area hides the workspace).
 * `dialog` shows Settings in the shared Modal over the visible work context: short preferences in a
 * bounded shell, collections and list/detail pages wider, with an optional maximize/restore.
 */
export type SettingsPresentationMode = "page" | "dialog";

export interface WorkspaceSettingsSurfaceProps {
  /** Defaults to `page` until the workspace keeps its chrome mounted behind the overlay. */
  presentation?: SettingsPresentationMode;
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
  /** The history loader's first-load failure/pending flags for `sidebarCwd`; Archive must not read either as an empty archive. */
  historyFailed?: boolean;
  historyPending?: boolean;
  onRetryHistory?: () => void;
  sessions: SettingsProps["liveSessions"];
  onCheckWorktreeRemoval: SettingsProps["onCheckWorktreeRemoval"];
  onDeleteWorktreeSessions: SettingsProps["onDeleteWorktreeSessions"];
  onCloseSettings: SettingsProps["onClose"];
  onSelectSettingsSection: SettingsProps["onSelectSection"];
  onOpenArchivedSession: SettingsProps["onOpenSession"];
  onOpenBackgroundSession?: SettingsProps["onOpenBackgroundSession"];
  onArchiveHistorySession: SettingsProps["onArchiveSession"];
  onDeleteHistorySession: SettingsProps["onDeleteSession"];
  onRestoreProject: SettingsProps["onRestoreProject"];
  onRemoveProject: (path: string, options: { purgeData: boolean }) => Promise<void>;
  onOpenWhatsNew: SettingsProps["onOpenWhatsNew"];
  collapsedProjectRailMode: SettingsProps["collapsedProjectRailMode"];
  setCollapsedProjectRailMode: SettingsProps["onCollapsedProjectRailModeChange"];
}

function WorkspaceSettingsSurfaceComponent({
  presentation = "page",
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
  historyFailed,
  historyPending,
  onRetryHistory,
  sessions,
  onCheckWorktreeRemoval,
  onDeleteWorktreeSessions,
  onCloseSettings,
  onSelectSettingsSection,
  onOpenArchivedSession,
  onOpenBackgroundSession,
  onArchiveHistorySession,
  onDeleteHistorySession,
  onRestoreProject,
  onRemoveProject,
  onOpenWhatsNew,
  collapsedProjectRailMode,
  setCollapsedProjectRailMode,
}: WorkspaceSettingsSurfaceProps) {
  useLocale();
  // Geometry state only: toggling it restyles the open dialog and never remounts Settings, so
  // drafts, selection, search and reveal state survive and closing returns to the same view.
  const [maximized, setMaximized] = useState(false);
  const toggleMaximize = useCallback(() => setMaximized((value) => !value), []);
  const settingsView = (embedded: boolean) => (
    <SettingsView
      section={settingsSection}
      anchor={settingsAnchor}
      notificationProjectPath={notificationProjectPath}
      notificationSettingsRequest={notificationSettingsRequest}
      recents={visibleRecents}
      cwd={sidebarCwd}
      sessions={sidebarHistory}
      sessionsStatus={sessionsStatus}
      liveSessions={sessions}
      onRemoveWorktree={onRemoveWorktree}
      onCheckWorktreeRemoval={onCheckWorktreeRemoval}
      onDeleteWorktreeSessions={onDeleteWorktreeSessions}
      embedded={embedded}
      maximized={embedded ? maximized : undefined}
      onToggleMaximize={embedded ? toggleMaximize : undefined}
      onClose={onCloseSettings}
      onSelectSection={onSelectSettingsSection}
      onOpenSession={onOpenArchivedSession}
      onOpenBackgroundSession={onOpenBackgroundSession}
      onArchiveSession={onArchiveHistorySession}
      onDeleteSession={onDeleteHistorySession}
      onRestoreProject={onRestoreProject}
      onDeleteProject={(path) => onRemoveProject(path, { purgeData: true })}
      onOpenWhatsNew={onOpenWhatsNew}
      collapsedProjectRailMode={collapsedProjectRailMode}
      onCollapsedProjectRailModeChange={setCollapsedProjectRailMode}
    />
  );
  // Only claim a status when the loader reported one; otherwise Archive keeps
  // its plain "ready" behaviour.
  const sessionsStatus = useMemo<SettingsProps["sessionsStatus"]>(() => {
    if (historyFailed) return { state: "unavailable", ...(onRetryHistory ? { onRetry: onRetryHistory } : {}) };
    if (historyPending) return { state: "loading" };
    if (historyFailed === undefined && historyPending === undefined) return undefined;
    return { state: "ready" };
  }, [historyFailed, historyPending, onRetryHistory]);
  return (
    <>
      {worktreeManagementRequest?.deletePath ? (
        <QuickDeleteWorktreeDialog
          key={worktreeManagementRevision}
          request={worktreeManagementRequest}
          onRemove={onRemoveWorktree}
          onClose={() => setWorktreeManagementRequest(null)}
        />
      ) : worktreeManagementRequest ? (
        <Modal
          key={worktreeManagementRevision}
          title={t("Worktrees")}
          size="lg"
          onClose={() => setWorktreeManagementRequest(null)}
        >
          <div className="p-4">
            <WorktreesPage
              cwd={worktreeManagementRequest.cwd}
              recents={visibleRecents}
              liveSessions={sessions}
              onRemove={onRemoveWorktree}
              onCheckRemove={onCheckWorktreeRemoval}
              onDeleteSessions={onDeleteWorktreeSessions}
            />
          </div>
        </Modal>
      ) : null}
      {settingsOpen && presentation === "dialog" ? (
        <Modal
          title={t("Settings")}
          minimalHeader
          size="lg"
          scroll="none"
          className="bycoda-settings-dialog"
          onClose={onCloseSettings}
        >
          <div
            className="bycoda-settings-dialog-body"
            data-settings-dialog-mode={
              maximized ? "maximized" : settingsSectionPresentation(settingsSection)
            }
          >
            {/* Loading and failure stay inside the dialog; the window chrome is not repeated. */}
            <RecoveryBoundary onBack={onCloseSettings}>
              <Suspense
                fallback={
                  <div
                    role="status"
                    className="flex flex-1 items-center justify-center gap-2 text-ui-secondary text-(--ui-text-secondary)"
                  >
                    <LoaderCircle aria-hidden="true" className="icon-sm animate-spin" />
                    {t("Loading Settings…")}
                  </div>
                }
              >
                {settingsView(true)}
              </Suspense>
            </RecoveryBoundary>
          </div>
        </Modal>
      ) : settingsOpen ? (
        <NavigationBoundary name="Settings" onBack={onCloseSettings}>
          {settingsView(false)}
        </NavigationBoundary>
      ) : null}
    </>
  );
}

const MemoWorkspaceSettingsSurface = memo(WorkspaceSettingsSurfaceComponent);

/** Workspace recreates most handlers per render; stable proxies let the memo hold. */
export function WorkspaceSettingsSurface(props: WorkspaceSettingsSurfaceProps) {
  return <MemoWorkspaceSettingsSurface {...useStableHandlers(props)} />;
}
