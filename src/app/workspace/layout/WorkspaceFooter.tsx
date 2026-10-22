import type { ComponentProps, Dispatch, SetStateAction } from "react";
import type { Session } from "../../../features/sessions/model/session";
import type { SettingsSectionId } from "../../../features/settings/model/settings";
import { canOpenTerminalIn } from "../../../features/projects/model/recents";
import { ProjectTerminalDock } from "../../../features/terminal/ui/ProjectTerminalDock";
import { ApprovalToasts } from "../../../features/sessions/ui/ApprovalToasts";
import { UsageFooter } from "../../shell/UsageFooter";
import { WorkspaceControls } from "../../shell/WorkspaceControls";
import { t } from "../../../shared/i18n";
import type { WorkspaceNoticesProps } from "./WorkspaceNotices";

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
  pullRequestsOnly: boolean;
  setPullRequestsOnly: Dispatch<SetStateAction<boolean>>;
  onOpenInbox: () => void;
  openSettings: WorkspaceNoticesProps["openSettings"];
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
  onShowProjectTerminal: UsageFooterProps["onShowTerminal"];
  currentProjectDock: ComponentProps<typeof ProjectTerminalDock>["dock"] | undefined;
  dockVisible: boolean;
  conversationTools: Omit<UsageFooterTools, "onOpenFile"> | null | undefined;
  onOpenFile: UsageFooterTools["onOpenFile"];
  // Approval toasts
  pendingNotifications: ApprovalProps["notices"];
  hiddenApprovalToasts: ApprovalProps["popupNotices"];
  reminderNoticesHeight: number;
  harnessUpdateHeight: number;
  onOpenApprovalSession: ApprovalProps["onFocusSession"];
  onApproval: ApprovalProps["onApproval"];
}

export function WorkspaceFooter({
  searchViewOpen,
  inboxViewOpen,
  notesViewOpen,
  serversViewOpen = false,
  automationsViewOpen,
  settingsOpen,
  settingsSection,
  pullRequestsOnly,
  setPullRequestsOnly,
  onOpenInbox,
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
  onShowProjectTerminal,
  currentProjectDock,
  dockVisible,
  conversationTools,
  onOpenFile,
  pendingNotifications,
  hiddenApprovalToasts,
  reminderNoticesHeight,
  harnessUpdateHeight,
  onOpenApprovalSession,
  onApproval,
}: WorkspaceFooterProps) {
  return (
    <div className="flex h-8 min-w-0 shrink-0 items-center border-t border-stroke">
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
          onNewTerminal={canOpenTerminalIn(projectCwd) ? onNewTerminal : undefined}
          onShowTerminal={canOpenTerminalIn(projectCwd) ? onShowProjectTerminal : undefined}
          terminalUnavailableReason={
            canOpenTerminalIn(projectCwd)
              ? undefined
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
            ? settingsSection === "usage"
            : !searchViewOpen && !notesViewOpen && !serversViewOpen && !automationsViewOpen)
        }
        onHiddenGroups={() => openSettings("groupLock")}
        onPullRequests={() => {
          onOpenInbox();
          setPullRequestsOnly(true);
        }}
        onUsage={() => openSettings("usage")}
        active={
          settingsOpen
            ? settingsSection === "usage"
              ? "usage"
              : settingsSection === "groupLock"
                ? "hiddenGroups"
                : undefined
            : inboxViewOpen && pullRequestsOnly
              ? "pullRequests"
              : undefined
        }
      />
      <div className="flex shrink-0 items-center pe-2">
        <ApprovalToasts
          notices={pendingNotifications}
          popupNotices={hiddenApprovalToasts}
          topOffset={
            48 +
            (reminderNoticesHeight ? reminderNoticesHeight + 8 : 0) +
            (harnessUpdateHeight ? harnessUpdateHeight + 8 : 0)
          }
          onFocusSession={onOpenApprovalSession}
          onApproval={onApproval}
        />
      </div>
    </div>
  );
}
