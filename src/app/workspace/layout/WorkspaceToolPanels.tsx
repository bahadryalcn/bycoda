import type { ComponentProps, Dispatch, SetStateAction } from "react";
import type { WorkspaceToolId, ToolWindow } from "../../model/toolWindows";
import { NavigationBoundary } from "../../shell/NavigationBoundary";
import { ToolNavigationContext, ToolPanel } from "../../shell/ToolNavigation";
import {
  AutomationsView,
  InboxView,
  NotesView,
  SocialView,
  TasksView,
  ServersView,
} from "../surfaces/lazySurfaces";

type InboxProps = ComponentProps<typeof InboxView>;
type NotesProps = ComponentProps<typeof NotesView>;
type AutomationsProps = ComponentProps<typeof AutomationsView>;
type SetBoolean = Dispatch<SetStateAction<boolean>>;

export interface WorkspaceToolPanelsProps {
  // Tool view open state and setters
  inboxViewOpen: boolean;
  notesViewOpen: boolean;
  serversViewOpen: boolean;
  automationsViewOpen: boolean;
  socialBoardShown: boolean;
  taskBoardShown: boolean;
  pullRequestsOnly: boolean;
  setFilePickerOpen: SetBoolean;
  setSettingsOpen: SetBoolean;
  setSearchViewOpen: SetBoolean;
  setInboxViewOpen: SetBoolean;
  setPullRequestsOnly: SetBoolean;
  setNotesViewOpen: SetBoolean;
  setServersViewOpen: SetBoolean;
  setAutomationsViewOpen: SetBoolean;
  setSocialBoardShown: SetBoolean;
  setTaskBoardShown: SetBoolean;
  // Workspace context
  projectCwd: string;
  socialPanelCwd: string;
  sidebarCwd: InboxProps["cwd"];
  visibleRecents: InboxProps["recents"];
  notesEnabled: boolean;
  toolWindow: ToolWindow | null | undefined;
  detachedSessionWindow: boolean;
  projectRailOpen: boolean;
  compactProjectRail: boolean;
  compactRailActive: boolean;
  onToggleSidebar: InboxProps["onToggleSidebar"];
  pickProject: InboxProps["onOpenProject"];
  // Inbox
  onLeaveInbox: InboxProps["onClose"];
  onStartInboxItem: InboxProps["onStart"];
  onAskInboxItem: InboxProps["onAsk"];
  onRestartInboxAsk: InboxProps["onAskRestart"];
  setInboxAskPortal: InboxProps["onAskMount"];
  inboxRelatedSessions: InboxProps["sessions"];
  repairSessions: InboxProps["repairSessions"];
  onRepairChecks: InboxProps["onRepairChecks"];
  onOpenInboxSession: InboxProps["onOpenSession"];
  onOpenInboxIntegrations: InboxProps["onOpenIntegrations"];
  // Notes, social, tasks, automations
  onLeaveNotes: NotesProps["onClose"];
  onLeaveServers: () => void;
  onLeaveAutomations: AutomationsProps["onClose"];
  onOpenBackgroundSession: AutomationsProps["onOpenBackgroundSession"];
  onOpenAutomationSession: AutomationsProps["onOpenSession"];
  onLaunchAutomationAssistant?: AutomationsProps["onLaunchAssistant"];
  launchAutomation: (
    automation: Parameters<AutomationsProps["onLaunch"]>[0],
    run: Parameters<AutomationsProps["onLaunch"]>[1],
    reveal: boolean,
  ) => Promise<void>;
}

export function WorkspaceToolPanels({
  inboxViewOpen,
  notesViewOpen,
  serversViewOpen,
  automationsViewOpen,
  socialBoardShown,
  taskBoardShown,
  pullRequestsOnly,
  setFilePickerOpen,
  setSettingsOpen,
  setSearchViewOpen,
  setInboxViewOpen,
  setPullRequestsOnly,
  setNotesViewOpen,
  setServersViewOpen,
  setAutomationsViewOpen,
  setSocialBoardShown,
  setTaskBoardShown,
  projectCwd,
  socialPanelCwd,
  sidebarCwd,
  visibleRecents,
  notesEnabled,
  toolWindow,
  detachedSessionWindow,
  projectRailOpen,
  compactProjectRail,
  compactRailActive,
  onToggleSidebar,
  pickProject,
  onLeaveInbox,
  onStartInboxItem,
  onAskInboxItem,
  onRestartInboxAsk,
  setInboxAskPortal,
  inboxRelatedSessions,
  repairSessions,
  onRepairChecks,
  onOpenInboxSession,
  onOpenInboxIntegrations,
  onLeaveNotes,
  onLeaveServers,
  onLeaveAutomations,
  onOpenBackgroundSession,
  onOpenAutomationSession,
  launchAutomation,
  onLaunchAutomationAssistant,
}: WorkspaceToolPanelsProps) {
  return (
    <ToolNavigationContext.Provider
      value={{
        active: serversViewOpen
          ? "servers"
          : inboxViewOpen
            ? "inbox"
            : notesViewOpen
              ? "notes"
              : automationsViewOpen
                ? socialBoardShown
                  ? "social"
                  : taskBoardShown
                    ? "tasks"
                    : "automations"
                : null,
        cwd:
          automationsViewOpen && socialBoardShown && socialPanelCwd ? socialPanelCwd : projectCwd,
        notesEnabled,
        includeServers: !toolWindow,
        grouped: toolWindow?.grouped ?? true,
        onSelect: (tool: WorkspaceToolId) => {
          setFilePickerOpen(false);
          setSettingsOpen(false);
          setSearchViewOpen(false);
          setInboxViewOpen(tool === "inbox");
          setPullRequestsOnly(false);
          setNotesViewOpen(tool === "notes" && notesEnabled);
          setServersViewOpen(tool === "servers");
          setAutomationsViewOpen(tool === "social" || tool === "tasks" || tool === "automations");
          setSocialBoardShown(tool === "social");
          setTaskBoardShown(tool === "tasks");
        },
      }}
    >
      <ToolPanel active={serversViewOpen} keepEffects>
        <NavigationBoundary name="Servers" onBack={onLeaveServers}>
          <ServersView
            besideRail={!detachedSessionWindow && (projectRailOpen || compactProjectRail)}
            compactRail={compactRailActive}
            onClose={onLeaveServers}
            onToggleSidebar={onToggleSidebar}
          />
        </NavigationBoundary>
      </ToolPanel>
      <ToolPanel active={inboxViewOpen}>
        <InboxView
          key={pullRequestsOnly ? "pullRequests" : "inbox"}
          pullRequestsOnly={pullRequestsOnly}
          onOpenProject={pickProject}
          cwd={sidebarCwd}
          recents={visibleRecents}
          besideRail={!detachedSessionWindow && (projectRailOpen || compactProjectRail)}
          compactRail={compactRailActive}
          onClose={onLeaveInbox}
          onToggleSidebar={toolWindow ? undefined : onToggleSidebar}
          onStart={onStartInboxItem}
          onAsk={onAskInboxItem}
          onAskRestart={onRestartInboxAsk}
          onAskMount={setInboxAskPortal}
          sessions={inboxRelatedSessions}
          repairSessions={repairSessions}
          onRepairChecks={onRepairChecks}
          onOpenSession={onOpenInboxSession}
          onOpenIntegrations={onOpenInboxIntegrations}
        />
      </ToolPanel>
      <ToolPanel active={notesViewOpen}>
        <NotesView
          besideRail={!detachedSessionWindow && (projectRailOpen || compactProjectRail)}
          compactRail={compactRailActive}
          cwd={projectCwd}
          recents={visibleRecents}
          onClose={onLeaveNotes}
          onToggleSidebar={toolWindow ? undefined : onToggleSidebar}
        />
      </ToolPanel>
      <ToolPanel active={automationsViewOpen && socialBoardShown}>
        <NavigationBoundary name="Social Media" onBack={onLeaveAutomations}>
          <SocialView
            cwd={socialPanelCwd || projectCwd}
            besideRail={!detachedSessionWindow && (projectRailOpen || compactProjectRail)}
            compactRail={compactRailActive}
            onToggleSidebar={toolWindow ? undefined : onToggleSidebar}
            onClose={onLeaveAutomations}
          />
        </NavigationBoundary>
      </ToolPanel>
      <ToolPanel active={automationsViewOpen && taskBoardShown && !socialBoardShown}>
        <NavigationBoundary name="Tasks" onBack={onLeaveAutomations}>
          <TasksView
            besideRail={!detachedSessionWindow && (projectRailOpen || compactProjectRail)}
            compactRail={compactRailActive}
            cwd={projectCwd}
            recents={visibleRecents}
            onClose={onLeaveAutomations}
            onToggleSidebar={toolWindow ? undefined : onToggleSidebar}
            onOpenBackgroundSession={onOpenBackgroundSession}
          />
        </NavigationBoundary>
      </ToolPanel>
      <ToolPanel active={automationsViewOpen && !taskBoardShown && !socialBoardShown}>
        <AutomationsView
          besideRail={!detachedSessionWindow && (projectRailOpen || compactProjectRail)}
          compactRail={compactRailActive}
          cwd={projectCwd}
          recents={visibleRecents}
          onClose={onLeaveAutomations}
          onToggleSidebar={toolWindow ? undefined : onToggleSidebar}
          onLaunchAssistant={onLaunchAutomationAssistant}
          onLaunch={(automation, run) => launchAutomation(automation, run, true)}
          onOpenSession={onOpenAutomationSession}
          onOpenBackgroundSession={onOpenBackgroundSession}
        />
      </ToolPanel>
    </ToolNavigationContext.Provider>
  );
}
