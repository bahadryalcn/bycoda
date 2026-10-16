import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { SOCIAL_PANEL_EVENT } from "../../../features/social/ui/SocialShortcut";
import { getGroupLockView } from "../../../features/group-lock/model/groupLock";
import { isProjectLockedIn } from "../../../features/group-lock/model/lockState";
import { canOpenTerminalIn } from "../../../features/projects/model/recents";
import { loadNotesEnabled } from "../../../features/settings/model/settings";
import type { SidebarTabId } from "../../../features/settings/model/appearance";
import { sessionsRef } from "../../../features/sessions/model/sessionsStore";
import type { WorkspaceTab } from "../../../features/workspace/model/layout";
import { pathKey } from "../../../shared/lib/paths";
import { APP_UI_SETTINGS, APP_UI_VIEWS, registerAppUiControl, type AppUiAction, type AppUiContext, type AppUiInput } from "../../model/appUiControl";
import type { useOpenSessionTargets } from "../sessions/useOpenSessionTargets";
import type { useSettingsSurfaceActions, useSettingsSurfaceState } from "../surfaces/useSettingsSurface";
import type { useSurfaceOpeners } from "../surfaces/useSurfaceOpeners";

type SettingsSurfaceState = ReturnType<typeof useSettingsSurfaceState>;
type SettingsSurfaceActions = ReturnType<typeof useSettingsSurfaceActions>;
type SurfaceOpeners = ReturnType<typeof useSurfaceOpeners>;

export interface AppUiControlDeps {
  /** Read-only workspace view state, snapshotted per render. */
  surface: {
    settingsOpen: boolean;
    searchViewOpen: boolean;
    inboxViewOpen: boolean;
    notesViewOpen: boolean;
    automationsViewOpen: boolean;
    socialBoardShown: boolean;
    taskBoardShown: boolean;
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
    setInboxViewOpen: Dispatch<SetStateAction<boolean>>;
    setNotesViewOpen: Dispatch<SetStateAction<boolean>>;
    setAutomationsViewOpen: Dispatch<SetStateAction<boolean>>;
    setSessionSidebarOpen: Dispatch<SetStateAction<boolean>>;
    setSidebarTab: (tab: SidebarTabId, project?: string) => void;
    onShowProjectTerminal: () => void;
    onHideProjectTerminal: () => void;
    onOpenNotes: SurfaceOpeners["onOpenNotes"];
    onOpenInbox: SurfaceOpeners["onOpenInbox"];
    onOpenAutomations: SurfaceOpeners["onOpenAutomations"];
    onOpenTasks: SurfaceOpeners["onOpenTasks"];
    onOpenSearch: () => void;
    openSettings: SettingsSurfaceActions["openSettings"];
  };
  focusOpenSession: ReturnType<typeof useOpenSessionTargets>["focusOpenSession"];
  /** Late-declared in Workspace; read lazily inside the executor, as before. */
  isDetachedSessionWindow: () => boolean;
}

/** Executes app UI control requests (`ui.workspace.*`) against the live workspace surfaces. */
export function useAppUiControl({ surface, actions, focusOpenSession, isDetachedSessionWindow }: AppUiControlDeps): void {
  const {
    settingsOpen,
    searchViewOpen,
    inboxViewOpen,
    notesViewOpen,
    automationsViewOpen,
    socialBoardShown,
    taskBoardShown,
    settingsSection,
    projectCwd,
    activeTab,
    sessionSidebarOpen,
    sidebarTab,
    dockVisible,
  } = surface;
  const {
    setSettingsOpen,
    setSearchViewOpen,
    setInboxViewOpen,
    setNotesViewOpen,
    setAutomationsViewOpen,
    setSessionSidebarOpen,
    setSidebarTab,
    onShowProjectTerminal,
    onHideProjectTerminal,
    onOpenNotes,
    onOpenInbox,
    onOpenAutomations,
    onOpenTasks,
    onOpenSearch,
    openSettings,
  } = actions;

  // Keep navigation on existing application callbacks; the native relay supplies the owner context.
  const appUiLive = useRef<(context: AppUiContext, action: AppUiAction, input: AppUiInput) => Promise<unknown>>(async () => { throw new Error("Workspace is not ready."); });
  appUiLive.current = async (context, action, input) => {
    const source = sessionsRef.current.find(session => session.id === context.sessionId);
    if (!source || pathKey(source.cwd) !== pathKey(context.cwd) || isProjectLockedIn(getGroupLockView().lock, source.cwd))
      throw new Error("Conversation workspace is unavailable or locked.");
    const visible = (marker: string) => Array.from(document.querySelectorAll<HTMLElement>(marker)).some(element => element.getClientRects().length > 0);
    const view = settingsOpen ? "settings" : searchViewOpen ? "search" : inboxViewOpen ? "inbox" : notesViewOpen ? "notes" : automationsViewOpen ? socialBoardShown ? "social" : taskBoardShown ? "tasks" : "automations" : "conversation";
    const ownProject = pathKey(projectCwd) === pathKey(source.cwd);
    const state = () => ({ view, cwd: projectCwd, sessionId: activeTab?.kind === "session" ? activeTab.focusedId : null,
      section: settingsOpen ? settingsSection : null,
      mounted: view === "conversation" ? !!activeTab : visible(`[data-app-${view}]`),
      filesOpen: ownProject && !isDetachedSessionWindow() && sessionSidebarOpen && sidebarTab === "files" && visible('[data-side-pane="workspace"]'),
      terminalOpen: ownProject && dockVisible && visible('[data-project-terminal-dock]') });
    if (action === "ui.workspace.list") return { views: APP_UI_VIEWS.map(id => ({ id,
      available: id === "notes" ? loadNotesEnabled() : id === "terminal" ? canOpenTerminalIn(source.cwd) : id === "files" ? !isDetachedSessionWindow() : true,
      operations: id === "conversation" ? ["open", "status"] : ["open", "close", "status"] })), settingsSections: APP_UI_SETTINGS };
    if (action === "ui.workspace.status") return state();
    if (action === "ui.workspace.close") {
      if (!ownProject) throw new Error("This conversation's project is not displayed; refusing to close another project's surface.");
      if (input.view === "conversation") throw new Error("Closing a conversation is not a navigation operation.");
      if (input.view === "files") { if (sidebarTab === "files") setSessionSidebarOpen(false); }
      else if (input.view === "terminal") onHideProjectTerminal();
      else if (view === input.view) {
        setSettingsOpen(false); setSearchViewOpen(false); setInboxViewOpen(false); setNotesViewOpen(false); setAutomationsViewOpen(false);
      }
    } else {
      if (input.view === "notes" && !loadNotesEnabled()) throw new Error("Notes is disabled; enable it in settings first.");
      if (input.view === "files" && isDetachedSessionWindow()) throw new Error("The project file sidebar is unavailable in this detached conversation window.");
      if (input.view === "terminal" && !canOpenTerminalIn(source.cwd)) throw new Error("The desktop terminal panel does not support this remote project; use the explicit machine terminal API.");
      const needsFocus = !ownProject || activeTab?.kind !== "session" || activeTab.focusedId !== source.id;
      if (needsFocus && !focusOpenSession(source.id)) throw new Error("The calling conversation has no open workspace tab.");
      // Focus updates project routing first; never navigate using a stale callback from another project.
      const deadline = Date.now() + 10000;
      while (needsFocus && appUiLive.current === appUiExecutor) {
        if (Date.now() >= deadline) throw new Error("Conversation project focus timed out.");
        await new Promise(resolve => window.setTimeout(resolve, 40));
      }
      if (needsFocus) {
        const focused = await appUiLive.current(context, "ui.workspace.status", {}) as ReturnType<typeof state>;
        if (pathKey(focused.cwd) !== pathKey(source.cwd) || focused.sessionId !== source.id)
          throw new Error("Conversation focus changed before navigation; retry from the active conversation.");
        return appUiLive.current(context, action, input);
      }
      switch (input.view) {
        case "notes": onOpenNotes(true); break;
        case "inbox": onOpenInbox(true); break;
        case "automations": onOpenAutomations(true); break;
        case "tasks": onOpenTasks(true); break;
        case "search": onOpenSearch(); break;
        case "settings": openSettings(input.section); break;
        case "social": window.dispatchEvent(new CustomEvent(SOCIAL_PANEL_EVENT, { detail: { cwd: source.cwd, local: true } })); break;
        default:
          setSettingsOpen(false); setSearchViewOpen(false); setInboxViewOpen(false); setNotesViewOpen(false); setAutomationsViewOpen(false);
          if (input.view === "files") { setSidebarTab("files", source.cwd); setSessionSidebarOpen(true); }
          if (input.view === "terminal") onShowProjectTerminal();
      }
    }
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      await new Promise(resolve => window.setTimeout(resolve, 40));
      const result = await appUiLive.current(context, "ui.workspace.status", {});
      const current = result as ReturnType<typeof state>;
      if (action === "ui.workspace.close" ? input.view === "files" ? !current.filesOpen : input.view === "terminal" ? !current.terminalOpen : current.view !== input.view
        : input.view === "files" ? current.filesOpen : input.view === "terminal" ? current.terminalOpen : current.view === input.view && current.mounted && (!input.section || current.section === input.section)) return result;
    }
    throw new Error("Workspace UI acknowledgement timed out; read ui.workspace.status before retrying.");
  };
  const appUiExecutor = appUiLive.current;
  useEffect(() => registerAppUiControl((context, action, input) => appUiLive.current(context, action, input)), []);
}
