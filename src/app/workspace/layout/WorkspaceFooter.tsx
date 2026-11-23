import { memo } from "react";
import { useStableHandlers } from "../../../shared/hooks/useStableHandlers";
import type { ComponentProps } from "react";
import type { Session } from "../../../features/sessions/model/session";
import type { SettingsSectionId } from "../../../features/settings/model/settings";
import { canOpenTerminalIn } from "../../../features/projects/model/recents";
import { parseRemotePath } from "../../../features/connections/public/remoteProjects";
import { ProjectTerminalDock } from "../../../features/terminal/ui/ProjectTerminalDock";
import { ApprovalToasts } from "../../../features/sessions/ui/ApprovalToasts";
import { LocalHostVersionPrompt } from "../../../features/connections/public/LocalHostDownNotice";
import { runUpdateFlow } from "../../model/updater";
import { HiddenDictationIndicator } from "../../../features/voice/ui/HiddenDictationIndicator";
import { UsageFooter } from "../../shell/UsageFooter";
import { WorkspaceControls } from "../../shell/WorkspaceControls";
import { useT } from "../../../shared/i18n";
import { requestBackgroundTarget } from "../input/backgroundTargets";
import type { SettingsAnchor } from "../../../features/settings/ui/SettingsView";
import { surfaceAttributes } from "../../../shared/ui/Surface";

type UsageFooterProps = ComponentProps<typeof UsageFooter>;
type UsageFooterTools = NonNullable<UsageFooterProps["tools"]>;
type ApprovalProps = ComponentProps<typeof ApprovalToasts>;

export interface WorkspaceFooterProps {
  // Surface state that hides the usage footer and drives the controls
  searchViewOpen: boolean;
  inboxViewOpen: boolean;
  notesViewOpen: boolean;
  serversViewOpen?: boolean;
  automationsViewOpen: boolean;
  settingsOpen: boolean;
  settingsSection: SettingsSectionId;
  openSettings: (section?: SettingsSectionId, anchor?: SettingsAnchor) => void;
  // Usage and project terminal
  active: Session | undefined;
  projectCwd: string;
  usageProviders: UsageFooterProps["providers"];
  usageSession: UsageFooterProps["session"];
  onSelectProviderAccount: UsageFooterProps["onSelectAccount"];
  runningTerminals: UsageFooterProps["terminals"];
  runningTerminalOpen: UsageFooterProps["terminalOpen"];
  onToggleRunningTerminal: UsageFooterProps["onToggleTerminal"];
  onNewTerminal: UsageFooterProps["onNewTerminal"];
  remoteTerminalAvailable?: boolean;
  onShowProjectTerminal: UsageFooterProps["onShowTerminal"];
  currentProjectDock: ComponentProps<typeof ProjectTerminalDock>["dock"] | undefined;
  dockVisible: boolean;
  conversationTools: Omit<UsageFooterTools, "onOpenFile"> | null | undefined;
  onOpenFile: UsageFooterTools["onOpenFile"];
  // Approval toasts
  pendingNotifications: ApprovalProps["notices"];
  hiddenApprovalToasts: ApprovalProps["popupNotices"];
  onOpenApprovalSession: (sessionId: string) => void | Promise<boolean>;
  onApproval: ApprovalProps["onApproval"];
}

function WorkspaceFooterComponent({
  searchViewOpen,
  inboxViewOpen,
  notesViewOpen,
  serversViewOpen = false,
  automationsViewOpen,
  settingsOpen,
  settingsSection,
  openSettings,
  active,
  projectCwd,
  usageProviders,
  usageSession,
  onSelectProviderAccount,
  runningTerminals,
  runningTerminalOpen,
  onToggleRunningTerminal,
  onNewTerminal,
  remoteTerminalAvailable,
  onShowProjectTerminal,
  currentProjectDock,
  dockVisible,
  conversationTools,
  onOpenFile,
  pendingNotifications,
  hiddenApprovalToasts,
  onOpenApprovalSession,
  onApproval,
}: WorkspaceFooterProps) {
  // Subscribes to locale changes so the memoized footer re-renders with the new strings.
  const t = useT();
  return (
    <div
      data-workspace-footer
      {...surfaceAttributes(
        { frame: "pane", edge: "top" },
        "@container/footer flex h-8 min-w-0 shrink-0 items-center gap-1 px-1.5",
      )}
    >
      {searchViewOpen ||
      inboxViewOpen ||
      notesViewOpen ||
      serversViewOpen ||
      automationsViewOpen ||
      settingsOpen ? null : (
        <UsageFooter
          embedded
          providers={usageProviders}
          session={usageSession}
          project={active?.cwd ?? projectCwd}
          onSelectAccount={onSelectProviderAccount}
          onManageAccounts={() => openSettings("providers", "provider-accounts")}
          terminals={runningTerminals}
          terminalOpen={runningTerminalOpen}
          onToggleTerminal={onToggleRunningTerminal}
          onNewTerminal={
            remoteTerminalAvailable || canOpenTerminalIn(projectCwd) ? onNewTerminal : undefined
          }
          onShowTerminal={
            currentProjectDock || remoteTerminalAvailable || canOpenTerminalIn(projectCwd)
              ? onShowProjectTerminal
              : undefined
          }
          terminalUnavailableReason={
            currentProjectDock || remoteTerminalAvailable || canOpenTerminalIn(projectCwd)
              ? undefined
              : parseRemotePath(projectCwd)
                ? t("Set up an SSH connection to this project's machine to open a terminal.")
                : t(
                    "The terminal panel is available for local folders. Open this project on its machine to use it.",
                  )
          }
          projectTerminalActive={!!currentProjectDock && currentProjectDock.pane.files.length > 0}
          projectTerminalVisible={dockVisible}
          tools={conversationTools ? { ...conversationTools, onOpenFile } : undefined}
        />
      )}
      <WorkspaceControls
        canRefresh={
          inboxViewOpen ||
          (settingsOpen
            ? settingsSection === "providers" || settingsSection === "usage"
            : !searchViewOpen && !notesViewOpen && !serversViewOpen && !automationsViewOpen)
        }
      />
      <div className="flex shrink-0 items-center gap-1">
        <LocalHostVersionPrompt onUpdateApp={updateApp} />
        <HiddenDictationIndicator onOpenSession={onOpenApprovalSession} />
        <ApprovalToasts
          notices={pendingNotifications}
          popupNotices={hiddenApprovalToasts}
          onFocusSession={onOpenApprovalSession}
          onOpenHistorySession={onOpenApprovalSession}
          onOpenBackground={requestBackgroundTarget}
          onOpenSettings={() => openSettings("notifications", "notifications")}
          onApproval={onApproval}
        />
      </div>
    </div>
  );
}

/** The same owner-visible flow as "Check for Updates": it reports when no update exists. */
const updateApp = async () => {
  await runUpdateFlow(true);
};

const MemoWorkspaceFooter = memo(WorkspaceFooterComponent);

/** Workspace recreates most handlers per render; stable proxies let the memo hold. */
export function WorkspaceFooter(props: WorkspaceFooterProps) {
  return <MemoWorkspaceFooter {...useStableHandlers(props)} />;
}
