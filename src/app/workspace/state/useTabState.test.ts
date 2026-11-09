// @vitest-environment happy-dom
import { act, createElement, type SetStateAction } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useActiveTabSetter, useTabState } from "./useTabState";
import { newSession } from "../../../features/sessions/model/session";
import { getSessions, setSessions } from "../../../features/sessions/model/sessionsStore";
import { newTab } from "../../../features/workspace/model/layout";

it.each(["advisor", "subagent"])(
  "removes a %s tab when its lineage arrives without removing the session",
  (kind) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const root = createRoot(container);
    const parent = { ...newSession("codex", "/repo"), id: "parent" };
    const child = { ...newSession("codex", "/repo"), id: "child" };
    const seed = { session: parent, tab: newTab(parent.id) };
    const childTab = newTab(child.id);
    setSessions([parent, child]);
    let tabs!: ReturnType<typeof useTabState>;
    function Harness() {
      tabs = useTabState({
        seed,
        windowTransfer: null,
        resumed: {
          tabs: [seed.tab, childTab],
          sessions: [parent, child],
          activeTabId: childTab.id,
          projectCwd: "/repo",
          projectTerminals: [],
          projectReturnMemory: new Map(),
        },
      });
      return null;
    }
    try {
      act(() => root.render(createElement(Harness)));
      expect(tabs.tabs).toHaveLength(2);
      expect(tabs.activeTabId).toBe(childTab.id);
      const linked = {
        ...child,
        modelSettings: {
          delegationParent: JSON.stringify({
            parentSessionId: parent.id,
            runId: "run",
            kind,
            model: "codex:m",
            startedAt: 1,
          }),
        },
      };
      act(() => setSessions([parent, linked]));
      expect(tabs.tabs.map((tab) => tab.id)).toEqual([seed.tab.id]);
      expect(tabs.activeTabId).toBe(seed.tab.id);
      expect(getSessions().map((session) => session.id)).toEqual([parent.id, child.id]);
      // A reloading shell can briefly lack its lineage; the hidden tab must not
      // come back and take focus from the parent.
      act(() => setSessions([parent, child]));
      expect(tabs.tabs.map((tab) => tab.id)).toEqual([seed.tab.id]);
      expect(tabs.activeTabId).toBe(seed.tab.id);
      act(() => setSessions([parent, linked]));
      act(() => tabs.setTabs((previous) => [...previous, newTab(child.id)]));
      expect(tabs.tabs.map((tab) => tab.id)).toEqual([seed.tab.id]);
    } finally {
      act(() => root.unmount());
      setSessions([]);
      vi.unstubAllGlobals();
    }
  },
);

it("requests composer focus and leaves the terminal on every explicit session activation", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const cancel = vi.fn();
  const setActiveTabIdState = vi.fn();
  const setProjectTerminalFocused = vi.fn();
  let token = 0;
  const setComposerFocusToken = vi.fn((update: SetStateAction<number>) => {
    token = typeof update === "function" ? update(token) : update;
  });
  let activate!: (id: string) => void;
  function Harness() {
    activate = useActiveTabSetter({
      cancel,
      setActiveTabIdState,
      setProjectTerminalFocused,
      setComposerFocusToken,
    });
    return null;
  }
  try {
    act(() => root.render(createElement(Harness)));
    act(() => activate("new-session"));
    act(() => activate("existing-session"));
    act(() => activate("existing-session"));
    expect(token).toBe(3);
    expect(setProjectTerminalFocused).toHaveBeenCalledTimes(3);
    expect(setProjectTerminalFocused).toHaveBeenLastCalledWith(false);
    expect(setActiveTabIdState).toHaveBeenLastCalledWith("existing-session");
    expect(cancel).toHaveBeenCalledTimes(3);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
