// @vitest-environment happy-dom
import { act, createElement, useState, type Dispatch, type SetStateAction } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRailNavigation } from "./useRailNavigation";
import { useMouseNavigation } from "../../hooks/useMouseNavigation";
import type { AuxiliaryToolId } from "../../model/toolWindows";

vi.mock("../../../features/settings/model/settings", () => ({
  loadNotesEnabled: () => notesEnabled,
}));
let notesEnabled = true;
const initial = {
  activeTabId: "a",
  projectCwd: "/a",
  socialPanelCwd: "",
  settingsOpen: false,
  searchViewOpen: false,
  inboxViewOpen: false,
  notesViewOpen: false,
  automationsViewOpen: false,
  socialBoardShown: false,
  taskBoardShown: false,
  serversViewOpen: false,
  auxiliaryTool: null as AuxiliaryToolId | null,
};
type State = typeof initial;
const disposals: (() => void)[] = [];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  notesEnabled = true;
});
afterEach(() => {
  disposals.splice(0).forEach((dispose) => dispose());
  vi.unstubAllGlobals();
});

function mount(toolWindow = false, mouse = false) {
  let state!: State;
  let navigation!: ReturnType<typeof useRailNavigation>;
  let change!: (next: Partial<State>) => void;
  let setTabs!: Dispatch<SetStateAction<Set<string>>>;
  const activate = vi.fn();
  function Harness() {
    const [current, setCurrent] = useState({ ...initial, notesViewOpen: toolWindow });
    const [tabs, updateTabs] = useState(new Set(["a", "b", "c"]));
    state = current;
    setTabs = updateTabs;
    change = (next) => setCurrent((prev) => ({ ...prev, ...next }));
    function setter<K extends keyof State>(key: K): Dispatch<SetStateAction<State[K]>> {
      return (value) =>
        setCurrent((prev) => ({
          ...prev,
          [key]:
            typeof value === "function" ? (value as (old: State[K]) => State[K])(prev[key]) : value,
        }));
    }
    navigation = useRailNavigation({
      ...current,
      toolWindow,
      openTabIds: tabs,
      activateTab: (id) => {
        activate(id);
        change({ activeTabId: id });
      },
      setProjectCwd: setter("projectCwd"),
      setSocialPanelCwd: setter("socialPanelCwd"),
      setSettingsOpen: setter("settingsOpen"),
      setSearchViewOpen: setter("searchViewOpen"),
      setInboxViewOpen: setter("inboxViewOpen"),
      setNotesViewOpen: setter("notesViewOpen"),
      setAutomationsViewOpen: setter("automationsViewOpen"),
      setSocialBoardShown: setter("socialBoardShown"),
      setTaskBoardShown: setter("taskBoardShown"),
      setServersViewOpen: setter("serversViewOpen"),
      setAuxiliaryTool: setter("auxiliaryTool"),
    });
    return mouse
      ? createElement(Mouse, { back: navigation.onRailBack, forward: navigation.onRailForward })
      : null;
  }
  function Mouse({ back, forward }: { back: () => void; forward: () => void }) {
    useMouseNavigation(back, forward);
    return createElement("textarea");
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(createElement(Harness)));
  disposals.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return {
    get state() {
      return state;
    },
    get nav() {
      return navigation.navigation;
    },
    activate,
    go(next: Partial<State>) {
      act(() => change(next));
    },
    back() {
      act(() => navigation.onRailBack());
    },
    forward() {
      act(() => navigation.onRailForward());
    },
    close(id: string) {
      act(() => setTabs((prev) => new Set([...prev].filter((tab) => tab !== id))));
    },
    mouse(button: number) {
      act(() => {
        for (const type of ["mousedown", "mouseup", "auxclick"]) {
          const event = new MouseEvent(type, { button, bubbles: true, cancelable: true });
          container.querySelector("textarea")!.dispatchEvent(event);
          expect(event.defaultPrevented).toBe(true);
        }
      });
    },
  };
}

it("keeps a tools window at its initial tool at both history boundaries", () => {
  const w = mount(true, true);
  w.mouse(3);
  w.mouse(4);
  expect(w.state.notesViewOpen).toBe(true);
  expect(w.nav).toEqual({ canBack: false, canForward: false });
  expect(w.activate).not.toHaveBeenCalled();
});

it("walks Notes, Tasks, Social, Automations and Inbox in actual mouse visit order", () => {
  const w = mount(true, true);
  w.go({ notesViewOpen: false, automationsViewOpen: true, taskBoardShown: true });
  w.go({ taskBoardShown: false, socialBoardShown: true });
  w.go({ socialBoardShown: false });
  w.go({ automationsViewOpen: false, inboxViewOpen: true });
  w.mouse(3);
  expect(w.state.automationsViewOpen).toBe(true);
  w.mouse(3);
  expect(w.state.socialBoardShown).toBe(true);
  w.mouse(3);
  expect(w.state.taskBoardShown).toBe(true);
  w.mouse(3);
  expect(w.state.notesViewOpen).toBe(true);
  w.mouse(3);
  expect(w.state.notesViewOpen).toBe(true);
  for (let i = 0; i < 4; i++) w.mouse(4);
  expect(w.state.inboxViewOpen).toBe(true);
  expect(w.activate).not.toHaveBeenCalled();
});

it("keeps independent history in the main, tools and detached session windows", () => {
  const main = mount();
  const tools = mount(true);
  const detached = mount();
  main.go({ activeTabId: "b", projectCwd: "/b" });
  tools.go({ notesViewOpen: false, inboxViewOpen: true });
  detached.go({ activeTabId: "c", projectCwd: "/c" });
  tools.back();
  expect(main.state.activeTabId).toBe("b");
  expect(detached.state.activeTabId).toBe("c");
  main.back();
  expect(main.state.activeTabId).toBe("a");
  expect(tools.state.notesViewOpen).toBe(true);
  detached.back();
  expect(detached.state.activeTabId).toBe("a");
});

it("restores mixed session, project, tool and settings visits in one order", () => {
  const w = mount();
  w.go({ activeTabId: "b", projectCwd: "/b" });
  w.go({ serversViewOpen: true });
  w.go({ serversViewOpen: false, settingsOpen: true });
  w.back();
  expect(w.state.serversViewOpen).toBe(true);
  w.back();
  expect(w.state.serversViewOpen).toBe(false);
  expect(w.state.activeTabId).toBe("b");
  w.back();
  expect(w.state.projectCwd).toBe("/a");
  expect(w.state.activeTabId).toBe("a");
  w.forward();
  w.forward();
  w.forward();
  expect(w.state.settingsOpen).toBe(true);
  expect(w.state.projectCwd).toBe("/b");
});

it("clears the forward branch after a fresh visit and ignores duplicate visits", () => {
  const w = mount(true);
  w.go({ inboxViewOpen: true, notesViewOpen: false });
  w.back();
  w.go({ automationsViewOpen: true, taskBoardShown: true, notesViewOpen: false });
  w.go({ taskBoardShown: true });
  expect(w.nav.canForward).toBe(false);
  w.forward();
  expect(w.state.taskBoardShown).toBe(true);
  w.back();
  expect(w.state.notesViewOpen).toBe(true);
  expect(w.nav.canBack).toBe(false);
});

it("prunes closed and transferred tabs instead of reopening them", () => {
  const w = mount();
  w.go({ activeTabId: "b", projectCwd: "/b" });
  w.go({ activeTabId: "c", projectCwd: "/c" });
  w.close("b");
  w.back();
  expect(w.state.activeTabId).toBe("a");
  w.close("c");
  w.forward();
  expect(w.state.activeTabId).toBe("a");
  expect(w.nav.canForward).toBe(false);
});

it("skips Notes if disabled and restores the Social project", () => {
  const w = mount(true);
  w.go({
    automationsViewOpen: true,
    socialBoardShown: true,
    notesViewOpen: false,
    socialPanelCwd: "/social",
  });
  w.go({ automationsViewOpen: false, inboxViewOpen: true });
  notesEnabled = false;
  w.back();
  expect(w.state.socialPanelCwd).toBe("/social");
  expect(w.nav.canBack).toBe(false);
  w.back();
  expect(w.state.socialBoardShown).toBe(true);
});

it("keeps auxiliary tools as distinct visits", () => {
  const w = mount(true);
  w.go({ notesViewOpen: false, automationsViewOpen: true, auxiliaryTool: "terminal" });
  w.go({ auxiliaryTool: "conversation-tools" });
  w.go({ auxiliaryTool: null });
  w.back();
  expect(w.state.auxiliaryTool).toBe("conversation-tools");
  w.back();
  expect(w.state.auxiliaryTool).toBe("terminal");
  w.back();
  expect(w.state.notesViewOpen).toBe(true);
  w.forward();
  expect(w.state.auxiliaryTool).toBe("terminal");
});

it("bounds the window history to the most recent 50 visits", () => {
  const w = mount(true);
  for (let i = 0; i < 70; i++) w.go({ projectCwd: `/project-${i}` });
  for (let i = 0; i < 50; i++) w.back();
  expect(w.state.projectCwd).toBe("/project-19");
  expect(w.nav.canBack).toBe(false);
  w.back();
  expect(w.state.projectCwd).toBe("/project-19");
});
