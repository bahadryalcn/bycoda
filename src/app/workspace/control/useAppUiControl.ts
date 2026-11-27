import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { SOCIAL_PANEL_EVENT } from "../../../features/social/ui/SocialShortcut";
import { getGroupLockView } from "../../../features/group-lock/model/groupLock";
import { isProjectLockedIn } from "../../../features/group-lock/model/lockState";
import { setCrewsPageOpen, useCrewsPageOpen } from "../../../features/crews/model/crewsPage";
import { canOpenTerminalIn } from "../../../features/projects/model/recents";
import { loadNotesEnabled } from "../../../features/settings/model/settings";
import type { SidebarTabId } from "../../../features/settings/model/appearance";
import { sessionsRef } from "../../../features/sessions/model/sessionsStore";
import type { WorkspaceTab } from "../../../features/workspace/model/layout";
import { pathKey } from "../../../shared/lib/paths";
import { elapsedSince, monotonicNow } from "../../../shared/lib/time/timestamps";
import {
  APP_UI_GLOBAL_VIEWS,
  APP_UI_SETTINGS,
  APP_UI_VIEWS,
  registerAppUiControl,
  type AppUiAction,
  type AppUiContext,
  type AppUiInput,
  type AppUiRequestContext,
} from "../../model/appUiControl";
import type { AuxiliaryToolId } from "../../model/toolWindows";
import { workspaceActiveTool } from "../layout/workspaceActiveTool";
import { useNavigationBreadcrumbs } from "./useNavigationBreadcrumbs";
import type { useOpenSessionTargets } from "../sessions/useOpenSessionTargets";
import type {
  useSettingsSurfaceActions,
  useSettingsSurfaceState,
} from "../surfaces/useSettingsSurface";
import type { useSurfaceOpeners } from "../surfaces/useSurfaceOpeners";

type SettingsSurfaceState = ReturnType<typeof useSettingsSurfaceState>;
type SettingsSurfaceActions = ReturnType<typeof useSettingsSurfaceActions>;
type SurfaceOpeners = ReturnType<typeof useSurfaceOpeners>;

/** The screen the workspace reports; `filesOpen`/`terminalOpen` only for their own scopes. */
type ViewState = {
  view: string;
  cwd?: string;
  sessionId?: string | null;
  section?: string | null;
  mounted: boolean;
  filesOpen?: boolean;
  terminalOpen?: boolean;
};

export interface AppUiControlDeps {
  /** Read-only workspace view state, snapshotted per render. */
  surface: {
    settingsOpen: boolean;
    searchViewOpen: boolean;
    searchDialogOpen: boolean;
    inboxViewOpen: boolean;
    notesViewOpen: boolean;
    serversViewOpen: boolean;
    automationsViewOpen: boolean;
    socialBoardShown: boolean;
    taskBoardShown: boolean;
    /** Auxiliary tool page shown over the automations surface; absent or null when none. */
    auxiliaryTool?: AuxiliaryToolId | null;
    settingsSection: SettingsSurfaceState["settingsSection"];
    projectCwd: string;
    activeTab: WorkspaceTab | null | undefined;
    sessionSidebarOpen: boolean;
    sidebarTab: SidebarTabId;
    dockVisible: boolean;
  };
  /** Navigation setters and open callbacks the executor drives. */
  actions: {
    setSettingsOpen: SettingsSurfaceState["setSettingsOpen"];
    setSearchViewOpen: Dispatch<SetStateAction<boolean>>;
    onLeaveSearch: () => void;
    setInboxViewOpen: Dispatch<SetStateAction<boolean>>;
    setNotesViewOpen: Dispatch<SetStateAction<boolean>>;
    setAutomationsViewOpen: Dispatch<SetStateAction<boolean>>;
    setServersViewOpen?: Dispatch<SetStateAction<boolean>>;
    setAuxiliaryTool: (tool: AuxiliaryToolId | null) => void;
    setSessionSidebarOpen: Dispatch<SetStateAction<boolean>>;
    setSidebarTab: (tab: SidebarTabId, project?: string) => void;
    onShowProjectTerminal: () => void;
    onHideProjectTerminal: () => void;
    onOpenNotes: SurfaceOpeners["onOpenNotes"];
    onOpenInbox: SurfaceOpeners["onOpenInbox"];
    onOpenAutomations: SurfaceOpeners["onOpenAutomations"];
    onOpenTasks: SurfaceOpeners["onOpenTasks"];
    onOpenServers?: SurfaceOpeners["onOpenServers"];
    onOpenCrews: SurfaceOpeners["onOpenCrews"];
    openSettings: SettingsSurfaceActions["openSettings"];
  };
  focusOpenSession: ReturnType<typeof useOpenSessionTargets>["focusOpenSession"];
  /** Late-declared in Workspace; read lazily inside the executor, as before. */
  isDetachedSessionWindow: () => boolean;
  terminalControl?: (
    context: AppUiContext,
    action: "terminals.create" | "terminals.close" | "terminals.interrupt",
    input: AppUiInput,
  ) => Promise<unknown>;
}

/**
 * Executes app UI control requests (`ui.workspace.*`) against the live workspace surfaces.
 * One view table drives open, close and readback for every scope: a conversation, an unlocked
 * project window, or the projectless global Room (only `APP_UI_GLOBAL_VIEWS`).
 */
export function useAppUiControl({
  surface,
  actions,
  focusOpenSession,
  isDetachedSessionWindow,
  terminalControl,
}: AppUiControlDeps): void {
  useNavigationBreadcrumbs(surface);
  const {
    settingsOpen,
    searchViewOpen,
    searchDialogOpen,
    inboxViewOpen,
    notesViewOpen,
    serversViewOpen,
    automationsViewOpen,
    socialBoardShown,
    taskBoardShown,
    auxiliaryTool,
    settingsSection,
    projectCwd,
    activeTab,
    sessionSidebarOpen,
    sidebarTab,
    dockVisible,
  } = surface;
  const crewsOpen = useCrewsPageOpen();
  const {
    setSettingsOpen,
    setSearchViewOpen,
    onLeaveSearch,
    setInboxViewOpen,
    setNotesViewOpen,
    setAutomationsViewOpen,
    setServersViewOpen,
    setAuxiliaryTool,
    setSessionSidebarOpen,
    setSidebarTab,
    onShowProjectTerminal,
    onHideProjectTerminal,
    onOpenNotes,
    onOpenInbox,
    onOpenAutomations,
    onOpenTasks,
    onOpenServers,
    onOpenCrews,
    openSettings,
  } = actions;

  const visible = (marker: string) =>
    Array.from(document.querySelectorAll<HTMLElement>(marker)).some(
      (element) => element.getClientRects().length > 0,
    );
  // The screen the workspace renders now: settings, then search, then the tool the rail shows.
  const workspaceView = (): string =>
    searchDialogOpen
      ? "search"
      : settingsOpen
        ? "settings"
        : searchViewOpen
          ? "search"
          : (workspaceActiveTool({
              crewsOpen,
              auxiliaryTool,
              automationsViewOpen,
              serversViewOpen,
              inboxViewOpen,
              notesViewOpen,
              socialBoardShown,
              taskBoardShown,
            }) ?? "conversation");
  const mountedView = (current: string) =>
    current === "conversation"
      ? !!activeTab
      : current === "conversation-tools" || current === "terminal" || current === "assistant"
        ? true
        : visible(`[data-app-${current}]`);

  // Closes one view. Closing a view that is not the one on screen changes nothing.
  const closeView = (view: string) => {
    if (view === "files") {
      if (sidebarTab === "files") setSessionSidebarOpen(false);
      return;
    }
    if (view === "terminal") {
      if (dockVisible) onHideProjectTerminal();
      return;
    }
    if (workspaceView() !== view) return;
    if (view === "settings") setSettingsOpen(false);
    else if (view === "search") onLeaveSearch();
    else if (view === "inbox") setInboxViewOpen(false);
    else if (view === "notes") setNotesViewOpen(false);
    else if (view === "servers") setServersViewOpen?.(false);
    else if (view === "crews") setCrewsPageOpen(false);
    else if (view === "assistant" || view === "conversation-tools") {
      // Auxiliary pages sit over the automations surface: leaving them returns to the conversation.
      setAuxiliaryTool(null);
      setAutomationsViewOpen(false);
    } else if (view === "automations" || view === "tasks" || view === "social")
      setAutomationsViewOpen(false);
  };

  // Opens one view. Crews is a full page that wins over the rail, so it closes before any other open.
  const openView = (view: string, section: AppUiInput["section"], cwd: string) => {
    if (searchDialogOpen) onLeaveSearch();
    if (crewsOpen && view !== "crews") setCrewsPageOpen(false);
    switch (view) {
      case "servers":
        onOpenServers?.();
        break;
      case "notes":
        onOpenNotes(true);
        break;
      case "inbox":
        onOpenInbox(true);
        break;
      case "automations":
        onOpenAutomations(true);
        break;
      case "tasks":
        onOpenTasks(true);
        break;
      case "search":
        // The Search view is the expanded surface; it reads back from searchViewOpen.
        setSettingsOpen(false);
        setInboxViewOpen(false);
        setNotesViewOpen(false);
        setAutomationsViewOpen(false);
        setServersViewOpen?.(false);
        setSearchViewOpen(true);
        break;
      case "settings":
        openSettings(section);
        break;
      case "social":
        window.dispatchEvent(new CustomEvent(SOCIAL_PANEL_EVENT, { detail: { cwd, local: true } }));
        break;
      case "crews":
        onOpenCrews();
        break;
      case "assistant":
        // The Room owns its tab state; it opens the assistant page on its own listener.
        setSettingsOpen(false);
        setSearchViewOpen(false);
        window.dispatchEvent(new CustomEvent("bycoda:open-assistant", { detail: {} }));
        break;
      case "conversation-tools":
        void onOpenAutomations(true);
        setAuxiliaryTool("conversation-tools");
        break;
      default:
        // Conversation, files and terminal: the conversation page with its side panels.
        setSettingsOpen(false);
        setSearchViewOpen(false);
        setInboxViewOpen(false);
        setNotesViewOpen(false);
        setAutomationsViewOpen(false);
        setServersViewOpen?.(false);
        setAuxiliaryTool(null);
        if (view === "files") {
          setSidebarTab("files", cwd);
          setSessionSidebarOpen(true);
        }
        if (view === "terminal") onShowProjectTerminal();
    }
  };

  // Keep navigation on existing application callbacks; the native relay supplies the owner context.
  const appUiLive = useRef<
    (context: AppUiRequestContext, action: AppUiAction, input: AppUiInput) => Promise<unknown>
  >(async () => {
    throw new Error("Workspace is not ready.");
  });
  appUiLive.current = async (context, action, input) => {
    if ("global" in context) return projectlessNavigation(context, action, input);
    const windowScope = "window" in context;
    // Window scope has no session: its empty id is never focused, read or matched to a conversation.
    const source = windowScope
      ? { id: "", cwd: context.cwd }
      : sessionsRef.current.find((session) => session.id === context.sessionId);
    if (
      !source ||
      pathKey(source.cwd) !== pathKey(context.cwd) ||
      isProjectLockedIn(getGroupLockView().lock, source.cwd)
    )
      throw new Error("Conversation workspace is unavailable or locked.");
    if (
      action === "terminals.pty.guard" ||
      action === "terminals.create" ||
      action === "terminals.close" ||
      action === "terminals.interrupt"
    ) {
      if ("window" in context)
        throw new Error("Terminal lifecycle requires a conversation window.");
      if (
        isDetachedSessionWindow() ||
        !canOpenTerminalIn(source.cwd) ||
        pathKey(projectCwd) !== pathKey(source.cwd) ||
        activeTab?.kind !== "session" ||
        activeTab.focusedId !== source.id
      )
        throw new Error(
          "Terminal lifecycle requires the calling conversation active in its local project workspace.",
        );
      if (!terminalControl) throw new Error("Terminal lifecycle is unavailable in this window.");
      if (action === "terminals.pty.guard") return { eligible: true };
      if (action === "terminals.create" && workspaceView() !== "conversation")
        await appUiLive.current(context, "ui.workspace.open", { view: "conversation" });
      return terminalControl(context, action, input);
    }
    const ownProject = pathKey(projectCwd) === pathKey(source.cwd);
    const surfaceState = (current: string): ViewState => ({
      view: current,
      cwd: projectCwd,
      sessionId: activeTab?.kind === "session" ? activeTab.focusedId : null,
      section: settingsOpen ? settingsSection : null,
      mounted: mountedView(current),
      filesOpen:
        ownProject &&
        !isDetachedSessionWindow() &&
        sessionSidebarOpen &&
        sidebarTab === "files" &&
        visible('[data-side-pane="workspace"]'),
      terminalOpen: ownProject && dockVisible && visible("[data-project-terminal-dock]"),
    });
    if (action === "ui.workspace.list")
      return {
        views: APP_UI_VIEWS.map((id) => ({
          id,
          available:
            id === "servers" || id === "crews" || id === "files"
              ? !isDetachedSessionWindow()
              : id === "notes"
                ? loadNotesEnabled()
                : id === "terminal"
                  ? canOpenTerminalIn(source.cwd)
                  : true,
          operations: id === "conversation" ? ["open", "status"] : ["open", "close", "status"],
        })),
        settingsSections: APP_UI_SETTINGS,
      };
    if (action === "ui.workspace.status" || action === "ui.workspace.acknowledge")
      return surfaceState(workspaceView());
    if (input.view === "servers" && isDetachedSessionWindow())
      throw new Error("Servers navigation is unavailable in this window.");
    if (action === "ui.workspace.close") {
      if (!ownProject)
        throw new Error(
          "This conversation's project is not displayed; refusing to close another project's surface.",
        );
      if (input.view === "conversation")
        throw new Error("Closing a conversation is not a navigation operation.");
      closeView(input.view as string);
    } else {
      // A window without a conversation can only show views of the project it displays; it cannot focus one.
      if (windowScope && !ownProject)
        throw new Error("The window's project is not displayed; open a conversation in it first.");
      if (input.view === "servers" && (isDetachedSessionWindow() || !onOpenServers))
        throw new Error("Servers navigation is unavailable in this window.");
      if (input.view === "crews" && isDetachedSessionWindow())
        throw new Error("Crews is a page of the main window and is unavailable here.");
      if (input.view === "notes" && !loadNotesEnabled())
        throw new Error("Notes is disabled; enable it in settings first.");
      if (input.view === "files" && isDetachedSessionWindow())
        throw new Error(
          "The project file sidebar is unavailable in this detached conversation window.",
        );
      if (input.view === "terminal" && !canOpenTerminalIn(source.cwd))
        throw new Error(
          "The desktop terminal panel does not support this remote project; use the explicit machine terminal API.",
        );
      const needsFocus =
        !windowScope &&
        (!ownProject || activeTab?.kind !== "session" || activeTab.focusedId !== source.id);
      if (needsFocus && !focusOpenSession(source.id))
        throw new Error("The calling conversation has no open workspace tab.");
      // Focus updates project routing first; never navigate using a stale callback from another project.
      const startedAt = monotonicNow();
      while (needsFocus && appUiLive.current === appUiExecutor) {
        if (elapsedSince(startedAt) >= 10000)
          throw new Error("Conversation project focus timed out.");
        await new Promise((resolve) => window.setTimeout(resolve, 40));
      }
      if (needsFocus) {
        const focused = (await appUiLive.current(context, "ui.workspace.status", {})) as ViewState;
        if (pathKey(focused.cwd ?? "") !== pathKey(source.cwd) || focused.sessionId !== source.id)
          throw new Error(
            "Conversation focus changed before navigation; retry from the active conversation.",
          );
        return appUiLive.current(context, action, input);
      }
      openView(input.view as string, input.section, source.cwd);
    }
    return settle(context, (current) => readback(action, input, current));
  };

  // Projectless scope: the global Room. It reads the same view table but never touches a project.
  const projectlessNavigation = async (
    context: AppUiRequestContext,
    action: AppUiAction,
    input: AppUiInput,
  ): Promise<unknown> => {
    const globalState = (): ViewState => {
      const current = workspaceView();
      return {
        view: current,
        section: settingsOpen ? settingsSection : null,
        mounted: mountedView(current),
      };
    };
    const isGlobal = (view: unknown) =>
      (APP_UI_GLOBAL_VIEWS as readonly string[]).includes(view as string);
    if (action === "ui.workspace.list")
      return {
        views: APP_UI_GLOBAL_VIEWS.map((id) => ({
          id,
          available: true,
          operations: ["open", "close", "status"],
        })),
        settingsSections: APP_UI_SETTINGS,
      };
    if (action === "ui.workspace.status" || action === "ui.workspace.acknowledge")
      return globalState();
    if (action === "ui.workspace.close") {
      const view = input.view as string;
      if (isGlobal(view)) closeView(view);
      // A project view left on screen cannot be closed from the projectless Room; nothing else changes.
      else if (workspaceView() === view)
        throw new Error("This view needs a project window; open an unlocked project first.");
    } else if (action === "ui.workspace.open") {
      if (!isGlobal(input.view))
        throw new Error(
          "This view needs a project. Open an unlocked project or conversation in this window first.",
        );
      openView(input.view as string, input.section, "");
    } else throw new Error("Unsupported workspace UI request.");
    return settle(context, (current) => readback(action, input, current));
  };

  const readback = (action: AppUiAction, input: AppUiInput, current: ViewState) =>
    action === "ui.workspace.close"
      ? input.view === "files"
        ? !current.filesOpen
        : input.view === "terminal"
          ? !current.terminalOpen
          : current.view !== input.view
      : input.view === "files"
        ? !!current.filesOpen
        : input.view === "terminal"
          ? !!current.terminalOpen
          : current.view === input.view &&
            current.mounted &&
            (!input.section || current.section === input.section);

  // Waits for the rendered workspace to show the requested state; then returns the fresh status.
  const settle = async (context: AppUiRequestContext, done: (current: ViewState) => boolean) => {
    const startedAt = monotonicNow();
    while (elapsedSince(startedAt) < 10000) {
      await new Promise((resolve) => window.setTimeout(resolve, 40));
      const current = (await appUiLive.current(
        context,
        "ui.workspace.acknowledge",
        {},
      )) as ViewState;
      if (done(current)) return appUiLive.current(context, "ui.workspace.status", {});
    }
    throw new Error(
      "Workspace UI acknowledgement timed out; read ui.workspace.status before retrying.",
    );
  };
  const appUiExecutor = appUiLive.current;
  useEffect(
    () =>
      registerAppUiControl((context, action, input) => appUiLive.current(context, action, input)),
    [],
  );
}
