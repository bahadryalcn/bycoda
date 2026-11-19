import {
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { loadNotesEnabled } from "../../../features/settings/model/settings";
import { setCrewsPageOpen, useCrewsPageOpen } from "../../../features/crews/model/crewsPage";
import type { AuxiliaryToolId } from "../../model/toolWindows";
import { workspaceActiveTool } from "../layout/workspaceActiveTool";

export interface SettingsReturnView {
  servers?: boolean;
  search: boolean;
  inbox: boolean;
  notes: boolean;
  automations: boolean;
}

type View =
  | "workspace"
  | "settings"
  | "search"
  | "servers"
  | "crews"
  | "inbox"
  | "notes"
  | "social"
  | "tasks"
  | "automations"
  | AuxiliaryToolId;
type Visit = { view: View; tabId: string; cwd: string };
type SetBoolean = Dispatch<SetStateAction<boolean>>;

export interface RailNavigationDeps {
  activeTabId: string;
  projectCwd: string;
  socialPanelCwd: string;
  toolWindow: boolean;
  openTabIds: ReadonlySet<string>;
  activateTab: (id: string) => void;
  setProjectCwd: Dispatch<SetStateAction<string>>;
  setSocialPanelCwd: Dispatch<SetStateAction<string>>;
  settingsOpen: boolean;
  searchViewOpen: boolean;
  inboxViewOpen: boolean;
  notesViewOpen: boolean;
  automationsViewOpen: boolean;
  auxiliaryTool?: AuxiliaryToolId | null;
  setAuxiliaryTool?: Dispatch<SetStateAction<AuxiliaryToolId | null>>;
  socialBoardShown: boolean;
  taskBoardShown: boolean;
  serversViewOpen: boolean;
  setServersViewOpen: SetBoolean;
  setSettingsOpen: SetBoolean;
  setSearchViewOpen: SetBoolean;
  setInboxViewOpen: SetBoolean;
  setNotesViewOpen: SetBoolean;
  setAutomationsViewOpen: SetBoolean;
  setSocialBoardShown: SetBoolean;
  setTaskBoardShown: SetBoolean;
}

const sameVisit = (a: Visit, b: Visit) =>
  a.view === b.view && a.tabId === b.tabId && a.cwd === b.cwd;

/** One chronological history per mounted window. Never share or persist this stack. */
export function useRailNavigation(d: RailNavigationDeps) {
  const crewsOpen = useCrewsPageOpen();
  const view: View = d.settingsOpen
    ? "settings"
    : d.searchViewOpen
      ? "search"
      : (workspaceActiveTool({
          crewsOpen,
          auxiliaryTool: d.auxiliaryTool,
          automationsViewOpen: d.automationsViewOpen,
          serversViewOpen: d.serversViewOpen,
          inboxViewOpen: d.inboxViewOpen,
          notesViewOpen: d.notesViewOpen,
          socialBoardShown: d.socialBoardShown,
          taskBoardShown: d.taskBoardShown,
        }) ?? "workspace");
  const current: Visit = {
    view,
    // Tool windows have a bootstrap session underneath their chrome. It is not a destination.
    tabId: d.toolWindow ? "" : d.activeTabId,
    cwd: view === "social" && d.socialPanelCwd ? d.socialPanelCwd : d.projectCwd,
  };
  const { toolWindow, openTabIds } = d;
  // The caller builds a new Set each render, so gate on its contents, not its identity.
  const openTabKey = JSON.stringify([...openTabIds]);
  // One settings read per commit; it is the only validity input outside React state.
  const notesEnabled = loadNotesEnabled();
  const valid = (visit: Visit) =>
    (!toolWindow || visit.view !== "workspace") &&
    (toolWindow || openTabIds.has(visit.tabId)) &&
    (visit.view !== "notes" || notesEnabled);
  const history = useRef({ back: [] as Visit[], current, forward: [] as Visit[] });
  const [navigation, setNavigation] = useState({ canBack: false, canForward: false });
  const updateNavigation = () => {
    const canBack = history.current.back.some(valid);
    const canForward = history.current.forward.some(valid);
    setNavigation((prev) =>
      prev.canBack === canBack && prev.canForward === canForward ? prev : { canBack, canForward },
    );
  };
  const syncNavigation = useEffectEvent(() => {
    const h = history.current;
    const back = h.back.filter(valid);
    const forward = h.forward.filter(valid);
    const previous = back[back.length - 1];
    if (
      !sameVisit(h.current, current) &&
      h.current.view !== "workspace" &&
      previous &&
      sameVisit(previous, current) &&
      valid(h.current)
    ) {
      // Closing a tool page (its close button, Escape or a click outside) returns
      // to where it was opened from. That is a Back step, not a new visit, so
      // Back does not reopen the page that was just closed.
      history.current = {
        back: back.slice(0, -1),
        current,
        forward: [...forward, h.current].slice(-50),
      };
    } else if (!sameVisit(h.current, current)) {
      // Closing/transferring a tab replaces its location; it must not reopen it.
      if (valid(h.current)) back.push(h.current);
      history.current = { back: back.slice(-50), current, forward: [] };
    } else if (back.length !== h.back.length || forward.length !== h.forward.length) {
      history.current = { ...h, back, forward };
    }
    updateNavigation();
  });
  // The stacks change only with the location, open tabs, tool-window mode or notes setting.
  useLayoutEffect(() => {
    syncNavigation();
  }, [current.view, current.tabId, current.cwd, toolWindow, openTabKey, notesEnabled]);

  const restore = (visit: Visit, previous: Visit) => {
    if (!d.toolWindow && visit.tabId !== previous.tabId) d.activateTab(visit.tabId);
    d.setProjectCwd(visit.cwd);
    if (visit.view === "social") d.setSocialPanelCwd(visit.cwd);
    d.setSettingsOpen(visit.view === "settings");
    d.setSearchViewOpen(visit.view === "search");
    d.setServersViewOpen(visit.view === "servers");
    // Closing Servers closed Crews; reopen it only for a Crews visit.
    setCrewsPageOpen(visit.view === "crews");
    d.setInboxViewOpen(visit.view === "inbox");
    d.setNotesViewOpen(visit.view === "notes");
    d.setAutomationsViewOpen(
      ["social", "tasks", "automations", "terminal", "conversation-tools", "assistant"].includes(
        visit.view,
      ),
    );
    d.setAuxiliaryTool?.(
      visit.view === "terminal" || visit.view === "conversation-tools" || visit.view === "assistant"
        ? visit.view
        : null,
    );
    d.setSocialBoardShown(visit.view === "social");
    d.setTaskBoardShown(visit.view === "tasks");
  };
  const step = (direction: "back" | "forward") => {
    const h = history.current;
    const entries = h[direction].filter(valid);
    const next = entries.pop();
    if (!next) {
      updateNavigation();
      return;
    }
    history.current =
      direction === "back"
        ? {
            back: entries,
            current: next,
            forward: [...h.forward.filter(valid), h.current].slice(-50),
          }
        : {
            back: [...h.back.filter(valid), h.current].slice(-50),
            current: next,
            forward: entries,
          };
    restore(next, h.current);
    updateNavigation();
  };
  return {
    navigation,
    surfaceForward: { canForward: navigation.canForward },
    onRailBack: () => step("back"),
    onRailForward: () => step("forward"),
    /** Closes every tool page and shows the current tab; the layout effect records the visit. */
    onShowWorkspace: () => {
      if (d.toolWindow || view === "workspace") return;
      restore({ view: "workspace", tabId: current.tabId, cwd: d.projectCwd }, current);
    },
  };
}
