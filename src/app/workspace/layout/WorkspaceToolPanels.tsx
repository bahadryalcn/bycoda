import { OverlayNav } from "../../shell/TitleBar";
import { WindowControls } from "../../shell/WindowControls";
import { IS_MAC } from "../../../platform/tauri/platform";
import { useMemo, useState } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import type { ConversationTools } from "../../../features/host-tools/SessionHostTools";
import { lazySurface } from "../../../shared/ui/lazySurface";
import { ToolNavigation } from "../../shell/ToolNavigation";
import type { ComponentProps, Dispatch, SetStateAction } from "react";
import type { AuxiliaryToolId, WorkspaceToolId, ToolWindow } from "../../model/toolWindows";
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

const SessionHostTools = lazySurface(
  async () => ({
    default: (await import("../../../features/host-tools/SessionHostTools")).SessionHostTools,
  }),
  { suspense: false },
);

const TerminalView = lazySurface(async () => ({
  default: (await import("../../../features/terminal/ui/TerminalView")).TerminalView,
}));

type InboxProps = ComponentProps<typeof InboxView>;
type NotesProps = ComponentProps<typeof NotesView>;
type AutomationsProps = ComponentProps<typeof AutomationsView>;
type SetBoolean = Dispatch<SetStateAction<boolean>>;

export interface WorkspaceToolPanelsProps {
  auxiliaryTool?: AuxiliaryToolId | null;
  setAuxiliaryTool?: (tool: AuxiliaryToolId | null) => void;
  conversationTools?: ConversationTools;
  navigation?: { canBack: boolean; canForward: boolean; onBack: () => void; onForward: () => void };
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
  auxiliaryTool,
  setAuxiliaryTool,
  conversationTools,
  navigation,
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
  onLeaveInbox: leaveInbox,
  onStartInboxItem,
  onAskInboxItem,
  onRestartInboxAsk,
  setInboxAskPortal,
  inboxRelatedSessions,
  repairSessions,
  onRepairChecks,
  onOpenInboxSession,
  onOpenInboxIntegrations,
  onLeaveNotes: leaveNotes,
  onLeaveServers: leaveServers,
  onLeaveAutomations: leaveAutomations,
  onOpenBackgroundSession,
  onOpenAutomationSession,
  launchAutomation,
  onLaunchAutomationAssistant,
}: WorkspaceToolPanelsProps) {
  const [terminalId] = useState(() => `tools-terminal-${crypto.randomUUID()}`);
  const onLeaveInbox = navigation?.onBack ?? leaveInbox;
  const onLeaveNotes = navigation?.onBack ?? leaveNotes;
  const onLeaveServers = navigation?.onBack ?? leaveServers;
  const onLeaveAutomations = navigation?.onBack ?? leaveAutomations;
  const auxiliaryHeader = (
    <div
      className="flex h-10 shrink-0 select-none items-center border-b border-stroke"
      data-tauri-drag-region="deep"
    >
      {IS_MAC && detachedSessionWindow ? <div className="w-[78px] shrink-0" /> : null}
      {detachedSessionWindow ? <OverlayNav onBack={onLeaveAutomations} /> : null}
      <ToolNavigation />
      {IS_MAC ? null : <WindowControls />}
    </div>
  );
  // The provider value keeps its identity across workspace renders, so tool
  // headers only re-render when navigation state changes.
  const navigationBack = useStableCallback(navigation?.onBack);
  const navigationForward = useStableCallback(navigation?.onForward);
  const canBack = navigation?.canBack ?? false;
  const canForward = navigation?.canForward ?? false;
  const history = useMemo(
    () =>
      navigationBack && navigationForward
        ? { canBack, canForward, onBack: navigationBack, onForward: navigationForward }
        : undefined,
    [canBack, canForward, navigationBack, navigationForward],
  );
  const activeTool: WorkspaceToolId | null =
    automationsViewOpen && auxiliaryTool
      ? auxiliaryTool
      : serversViewOpen
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
              : null;
  const toolCwd =
    automationsViewOpen && socialBoardShown && socialPanelCwd ? socialPanelCwd : projectCwd;
  const includeServers = !toolWindow || toolWindow.grouped || toolWindow.active === "servers";
  const includeAuxiliaryTools = !!setAuxiliaryTool;
  const grouped = toolWindow?.grouped ?? true;
  const onSelectTool = useStableCallback((tool: WorkspaceToolId) => {
    setFilePickerOpen(false);
    setSettingsOpen(false);
    setSearchViewOpen(false);
    setInboxViewOpen(tool === "inbox");
    setPullRequestsOnly(false);
    setNotesViewOpen(tool === "notes" && notesEnabled);
    setServersViewOpen(tool === "servers");
    setAutomationsViewOpen(
      tool === "social" ||
        tool === "tasks" ||
        tool === "automations" ||
        tool === "terminal" ||
        tool === "conversation-tools",
    );
    setAuxiliaryTool?.(tool === "terminal" || tool === "conversation-tools" ? tool : null);
    setSocialBoardShown(tool === "social");
    setTaskBoardShown(tool === "tasks");
  });
  const toolNavigation = useMemo(
    () => ({
      history,
      active: activeTool,
      cwd: toolCwd,
      notesEnabled,
      includeServers,
      includeAuxiliaryTools,
      grouped,
      onSelect: onSelectTool,
    }),
    [
      history,
      activeTool,
      toolCwd,
      notesEnabled,
      includeServers,
      includeAuxiliaryTools,
      grouped,
      onSelectTool,
    ],
  );
  return (
    <ToolNavigationContext.Provider value={toolNavigation}>
      <ToolPanel active={automationsViewOpen && auxiliaryTool === "conversation-tools"}>
        <NavigationBoundary name="Conversation tools" onBack={onLeaveAutomations}>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-(--ui-surface)">
            {auxiliaryHeader}
            <SessionHostTools
              {...(conversationTools ?? { cwd: projectCwd, sessionId: "", title: "" })}
              hideHeading
              hidePresentation
            />
          </div>
        </NavigationBoundary>
      </ToolPanel>
      <ToolPanel active={automationsViewOpen && auxiliaryTool === "terminal"} keepEffects>
        <NavigationBoundary name="Terminal" onBack={onLeaveAutomations}>
          {auxiliaryHeader}
          <div className="min-h-0 min-w-0 flex-1">
            <TerminalView
              id={terminalId}
              cwd={projectCwd}
              active={automationsViewOpen && auxiliaryTool === "terminal"}
            />
          </div>
        </NavigationBoundary>
      </ToolPanel>
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
        <NavigationBoundary name="Inbox" onBack={onLeaveInbox ?? onLeaveAutomations}>
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
        </NavigationBoundary>
      </ToolPanel>
      <ToolPanel active={notesViewOpen}>
        <NavigationBoundary name="Notes" onBack={onLeaveNotes}>
          <NotesView
            besideRail={!detachedSessionWindow && (projectRailOpen || compactProjectRail)}
            compactRail={compactRailActive}
            cwd={projectCwd}
            recents={visibleRecents}
            onClose={onLeaveNotes}
            onToggleSidebar={toolWindow ? undefined : onToggleSidebar}
          />
        </NavigationBoundary>
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
      <ToolPanel
        active={automationsViewOpen && !auxiliaryTool && !taskBoardShown && !socialBoardShown}
      >
        <NavigationBoundary name="Automations" onBack={onLeaveAutomations}>
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
        </NavigationBoundary>
      </ToolPanel>
    </ToolNavigationContext.Provider>
  );
}
