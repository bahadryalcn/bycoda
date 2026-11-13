import { OverlayNav } from "../../shell/TitleBar";
import { AssistantView } from "../surfaces/lazySurfaces";
import { isProjectLocked } from "../../../features/group-lock/model/groupLock";
import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../../features/connections/model/connections";
import type { HostGoal } from "../../../features/tasks/model/hostGoals";
import { AssistantResponseValidationSchema } from "../../../shared/model/host-contracts/assistant";
import { HostAutomationSchema } from "../../../shared/model/host-contracts/automations";
import {
  assistantAutomationProject,
  type AssistantAutomationReveal,
} from "../../../features/assistant/model/assistantAutomationReveal";
import { assistantJobTasksGoal } from "../../../features/assistant/model/assistantJobTasksReveal";
import type { RemoteMachine, HostSession } from "../../../features/connections/model/protocol";
import { useStableHandlers } from "../../../shared/hooks/useStableHandlers";
import { useHeldValue } from "../helpers/stableProps";
import { WindowControls } from "../../shell/WindowControls";
import { IS_MAC } from "../../../platform/tauri/platform";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { memo, useMemo, useState } from "react";
import { useAssistantRoomRequests } from "./useAssistantRoomRequests";
import { workspaceActiveTool } from "./workspaceActiveTool";
import { setCrewsPageOpen, useCrewsPageOpen } from "../../../features/crews/model/crewsPage";
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
  CrewsView,
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
  onSelectAssistantProject?: (path: string) => void;
  // Inbox
  onLeaveInbox: InboxProps["onClose"];
  onStartInboxItem: InboxProps["onStart"];
  onAskInboxItem: InboxProps["onAsk"];
  onRestartInboxAsk: InboxProps["onAskRestart"];
  setInboxAskPortal: InboxProps["onAskMount"];
  onOpenSocialSession?: ComponentProps<typeof SocialView>["onOpenSession"];
  onSocialSessionMount?: ComponentProps<typeof SocialView>["onSessionMount"];
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

function WorkspaceToolPanelsComponent({
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
  onSelectAssistantProject,
  onLeaveInbox: leaveInbox,
  onStartInboxItem,
  onAskInboxItem,
  onRestartInboxAsk,
  setInboxAskPortal,
  onOpenSocialSession,
  onSocialSessionMount,
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
  const crewsOpen = useCrewsPageOpen();
  const [terminalId] = useState(() => `tools-terminal-${crypto.randomUUID()}`);
  const [goalReveal, setGoalReveal] = useState<{
    machineId: string;
    goalId: string;
    token: number;
  }>();
  const [automationReveal, setAutomationReveal] = useState<AssistantAutomationReveal>();
  const canOpenAssistantProject = useStableCallback((path: string) => {
    const key = (value: string) => value.replace(/\\/g, "/").replace(/\/$/, "").toLocaleLowerCase();
    return (
      !isProjectLocked(path) && visibleRecents.some((project) => key(project.path) === key(path))
    );
  });
  const assistantNavigation = useAssistantRoomRequests({
    setInboxViewOpen,
    setNotesViewOpen,
    setServersViewOpen,
    setAutomationsViewOpen,
    setSocialBoardShown,
    setTaskBoardShown,
    setAuxiliaryTool,
  });
  const onLeaveInbox = navigation?.onBack ?? leaveInbox;
  const onLeaveNotes = navigation?.onBack ?? leaveNotes;
  const onLeaveServers = navigation?.onBack ?? leaveServers;
  const onLeaveAutomations = navigation?.onBack ?? leaveAutomations;
  const auxiliaryHeader = (
    <PaneHeader
      dragRegion
      chromeInset={detachedSessionWindow}
      leading={detachedSessionWindow ? <OverlayNav onBack={onLeaveAutomations} /> : undefined}
      trailing={IS_MAC ? null : <WindowControls />}
    >
      <ToolNavigation />
    </PaneHeader>
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
  const activeTool = workspaceActiveTool({
    crewsOpen,
    auxiliaryTool,
    automationsViewOpen,
    serversViewOpen,
    inboxViewOpen,
    notesViewOpen,
    socialBoardShown,
    taskBoardShown,
  });
  const toolCwd =
    automationsViewOpen && socialBoardShown && socialPanelCwd ? socialPanelCwd : projectCwd;
  const includeCrews = !toolWindow;
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
        tool === "conversation-tools" ||
        tool === "assistant",
    );
    setAuxiliaryTool?.(
      tool === "terminal" || tool === "conversation-tools" || tool === "assistant" ? tool : null,
    );
    // Leaving Servers above closed Crews; open it last.
    if (tool === "crews") setCrewsPageOpen(true);
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
      includeCrews,
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
      includeCrews,
      includeAuxiliaryTools,
      grouped,
      onSelectTool,
    ],
  );
  return (
    <ToolNavigationContext.Provider value={toolNavigation}>
      <ToolPanel active={automationsViewOpen && auxiliaryTool === "assistant"}>
        {auxiliaryHeader}
        <AssistantView
          projectPath={projectCwd}
          visibleProjectPaths={visibleRecents.map((project) => project.path)}
          initialTab={assistantNavigation.tab}
          navigationToken={assistantNavigation.token}
          onClose={onLeaveAutomations}
          onOpenProject={
            onSelectAssistantProject
              ? (path) => {
                  if (!canOpenAssistantProject(path))
                    throw new Error("The linked project is unavailable.");
                  onSelectAssistantProject(path);
                }
              : undefined
          }
          onOpenGoal={async (target) => {
            const machine = await invoke<RemoteMachine | null>("local_host_connect");
            if (!machine) throw new Error("The approval's original Host is unavailable.");
            const [environment, projects, goals] = await Promise.all([
              remoteRequest<{ environmentId: string }>(
                machine.id,
                "environment.describe",
                {},
                false,
                false,
                target.environmentId,
              ),
              remoteRequest(
                machine.id,
                "assistant.request",
                { op: "projects.list" },
                false,
                false,
                target.environmentId,
              ).then((value) => AssistantResponseValidationSchema.parse(value)),
              remoteRequest<HostGoal[]>(
                machine.id,
                "goals.list",
                {},
                false,
                false,
                target.environmentId,
              ),
            ]);
            const project = projects.projects?.find((value) => value.id === target.projectId);
            const goal = goals.find((value) => value.id === target.goalId);
            const expectedProjects = [...new Set(target.projectIds ?? [target.projectId])].sort();
            const actualProjects = [...new Set(goal?.projectIds ?? [])].sort();
            const allVisible = actualProjects.every((id) => {
              const value = projects.projects?.find((project) => project.id === id);
              return !!value && canOpenAssistantProject(value.path);
            });
            if (
              environment.environmentId !== target.environmentId ||
              !project ||
              !allVisible ||
              !canOpenAssistantProject(project.path) ||
              !goal ||
              goal.status !== "awaiting-approval" ||
              JSON.stringify(actualProjects) !== JSON.stringify(expectedProjects) ||
              !goal.projectIds.includes(project.id) ||
              goal.updatedAt !== target.updatedAt ||
              JSON.stringify(goal.plan) !== target.planIdentity
            )
              throw new Error("The original goal approval changed or its project is unavailable.");
            setGoalReveal({ machineId: machine.id, goalId: goal.id, token: Date.now() });
            onSelectTool("tasks");
          }}
          onReviewJobTasks={async (target) => {
            const machine = await invoke<RemoteMachine | null>("local_host_connect");
            if (!machine || !target.environmentId)
              throw new Error("The linked job's Host identity is unavailable.");
            const [environment, projects, response, goals] = await Promise.all([
              remoteRequest<{ environmentId: string }>(
                machine.id,
                "environment.describe",
                {},
                false,
                false,
                target.environmentId,
              ),
              remoteRequest(
                machine.id,
                "assistant.request",
                { op: "projects.list" },
                false,
                false,
                target.environmentId,
              ).then((value) => AssistantResponseValidationSchema.parse(value)),
              remoteRequest(
                machine.id,
                "assistant.request",
                { op: "jobs.get", id: target.jobId },
                false,
                false,
                target.environmentId,
              ).then((value) => AssistantResponseValidationSchema.parse(value)),
              remoteRequest<HostGoal[]>(
                machine.id,
                "goals.list",
                {},
                false,
                false,
                target.environmentId,
              ),
            ]);
            const current = await invoke<RemoteMachine | null>("local_host_connect");
            if (current?.id !== machine.id || current.environmentId !== target.environmentId)
              throw new Error("The linked job's Host identity is unavailable.");
            const goal = assistantJobTasksGoal(
              target,
              environment.environmentId,
              response.job,
              goals,
              projects.projects ?? [],
              canOpenAssistantProject,
            );
            setGoalReveal({ machineId: machine.id, goalId: goal.id, token: Date.now() });
            onSelectTool("tasks");
          }}
          onOpenAutomation={async (target) => {
            const machine = await invoke<RemoteMachine | null>("local_host_connect");
            if (!machine) throw new Error("This computer's Host is unavailable.");
            const expectedEnvironmentId = target.environmentId ?? machine.environmentId;
            if (!expectedEnvironmentId)
              throw new Error("The linked automation's Host identity is unavailable.");
            const [environment, projects, automations] = await Promise.all([
              remoteRequest<{ environmentId: string }>(
                machine.id,
                "environment.describe",
                {},
                false,
                false,
                expectedEnvironmentId,
              ),
              remoteRequest(
                machine.id,
                "assistant.request",
                { op: "projects.list" },
                false,
                false,
                expectedEnvironmentId,
              ).then((value) => AssistantResponseValidationSchema.parse(value)),
              remoteRequest(
                machine.id,
                "automations.list",
                {},
                false,
                false,
                expectedEnvironmentId,
              ).then((value) => HostAutomationSchema.array().parse(value)),
            ]);
            const current = await invoke<RemoteMachine | null>("local_host_connect");
            if (current?.id !== machine.id || current.environmentId !== expectedEnvironmentId)
              throw new Error("The linked automation's Host identity is unavailable.");
            assistantAutomationProject(
              target,
              expectedEnvironmentId,
              environment.environmentId,
              projects.projects ?? [],
              automations,
              canOpenAssistantProject,
            );
            setAutomationReveal({
              id: target.id,
              projectId: target.projectId,
              environmentId: expectedEnvironmentId,
              machineId: machine.id,
              token: Date.now(),
            });
            onSelectTool("automations");
          }}
          onOpenSession={async (sessionId, sourceEnvironmentId?: string) => {
            const machine = await invoke<RemoteMachine | null>("local_host_connect");
            if (!machine) throw new Error("This computer's Host is unavailable.");
            const expectedEnvironmentId = sourceEnvironmentId ?? machine.environmentId;
            if (!expectedEnvironmentId)
              throw new Error("The linked session's Host identity is unavailable.");
            const [host, projects] = await Promise.all([
              remoteRequest<HostSession | null>(
                machine.id,
                "sessions.get",
                {
                  sessionId,
                  preview: true,
                  summary: true,
                },
                false,
                false,
                expectedEnvironmentId,
              ),
              remoteRequest(
                machine.id,
                "assistant.request",
                { op: "projects.list" },
                false,
                false,
                expectedEnvironmentId,
              ).then((value) => AssistantResponseValidationSchema.parse(value)),
            ]);
            const project = projects.projects?.find((value) => value.id === host?.projectId);
            if (!host || !project || !canOpenAssistantProject(project.path))
              throw new Error("The linked session is unavailable.");
            await onOpenBackgroundSession({
              machineId: machine.id,
              projectId: host.projectId,
              cwd: host.session.cwd,
              sessionId,
            });
          }}
        />
      </ToolPanel>
      <ToolPanel active={automationsViewOpen && auxiliaryTool === "conversation-tools"}>
        <NavigationBoundary name="Conversation tools" onBack={onLeaveAutomations}>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
      <ToolPanel active={crewsOpen}>
        <NavigationBoundary name="Crews" onBack={onLeaveServers}>
          <CrewsView
            cwd={projectCwd}
            besideRail={!detachedSessionWindow && (projectRailOpen || compactProjectRail)}
            compactRail={compactRailActive}
            onClose={onLeaveServers}
            onToggleSidebar={onToggleSidebar}
            onOpenSession={onOpenBackgroundSession}
          />
        </NavigationBoundary>
      </ToolPanel>
      <ToolPanel active={serversViewOpen && !crewsOpen} keepEffects>
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
            onOpenSession={onOpenSocialSession}
            onSessionMount={onSocialSessionMount}
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
            goalReveal={goalReveal}
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
            revealAutomation={automationReveal}
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

const MemoWorkspaceToolPanels = memo(WorkspaceToolPanelsComponent);

/** Workspace recreates most handlers per render; stable proxies let the memo hold. */
export function WorkspaceToolPanels(props: WorkspaceToolPanelsProps) {
  // Rail layout only matters while a panel is shown; holding it while all are hidden
  // keeps a rail toggle from re-rendering every mounted panel.
  const crewsOpen = useCrewsPageOpen();
  const shown =
    crewsOpen ||
    props.inboxViewOpen ||
    props.notesViewOpen ||
    props.serversViewOpen ||
    props.automationsViewOpen;
  const projectRailOpen = useHeldValue(props.projectRailOpen, shown);
  const compactProjectRail = useHeldValue(props.compactProjectRail, shown);
  const compactRailActive = useHeldValue(props.compactRailActive, shown);
  return (
    <MemoWorkspaceToolPanels
      {...useStableHandlers({ ...props, projectRailOpen, compactProjectRail, compactRailActive })}
    />
  );
}
