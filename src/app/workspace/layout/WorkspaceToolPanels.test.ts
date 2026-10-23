// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WorkspaceToolPanels, type WorkspaceToolPanelsProps } from "./WorkspaceToolPanels";
import { ToolHeader } from "../../shell/ToolNavigation";
import { routeWindowDestination } from "../../model/windowNavigation";

vi.mock("../../model/windowNavigation", () => ({
  routeWindowDestination: vi.fn(async () => true),
}));
vi.mock("../../../features/connections/model/sshRunbookQueue", () => ({
  useSshRunbookQueue: () => ({ intents: [] }),
}));
vi.mock("../../../features/host-tools/SessionHostTools", () => ({
  SessionHostTools: () => createElement("div", { "data-conversation-tools": "" }),
}));
vi.mock("../../../features/terminal/ui/TerminalView", () => ({
  TerminalView: ({ active }: { active: boolean }) =>
    createElement("div", { "data-tool-terminal": "", "data-active": active }),
}));
vi.mock("../../shell/WindowControls", () => ({ WindowControls: () => null }));
vi.mock("../surfaces/lazySurfaces", () => {
  const view = () => createElement(ToolHeader, null, "Tool header");
  return {
    preloadToolSurface: vi.fn(),
    AutomationsView: view,
    InboxView: view,
    NotesView: view,
    SocialView: view,
    TasksView: view,
    ServersView: view,
  };
});

it.each([false, true])(
  "switches every tool locally and preserves the terminal (detached: %s)",
  async (detached) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const rootNode = document.createElement("div");
    document.body.append(rootNode);
    const root = createRoot(rootNode);
    const closeOverlay = vi.fn();
    function Workspace() {
      const [state, setState] = useState({
        inboxViewOpen: true,
        auxiliaryTool: null as "terminal" | "conversation-tools" | null,
        notesViewOpen: false,
        serversViewOpen: false,
        automationsViewOpen: false,
        socialBoardShown: false,
        taskBoardShown: false,
        pullRequestsOnly: true,
      });
      const setters = Object.fromEntries(
        Object.keys(state).map((key) => [
          `set${key[0].toUpperCase()}${key.slice(1)}`,
          (value: boolean | string | null) =>
            setState((previous) => ({ ...previous, [key]: value })),
        ]),
      );
      return createElement(WorkspaceToolPanels, {
        ...state,
        ...setters,
        projectCwd: "/repo",
        socialPanelCwd: "/repo/social",
        sidebarCwd: "/repo",
        visibleRecents: [],
        notesEnabled: true,
        toolWindow: detached ? { active: "inbox", cwd: "/repo", grouped: true } : null,
        detachedSessionWindow: detached,
        projectRailOpen: false,
        compactProjectRail: false,
        compactRailActive: false,
        setFilePickerOpen: closeOverlay,
        setSettingsOpen: closeOverlay,
        setSearchViewOpen: closeOverlay,
      } as unknown as WorkspaceToolPanelsProps);
    }
    const tabs = () => [...rootNode.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    try {
      await act(async () => root.render(createElement(Workspace)));
      for (const label of [
        "Notes",
        "Tasks",
        "Social Media",
        "Automations",
        "Inbox",
        "Servers",
        "Conversation tools",
        "Terminal",
        "Inbox",
      ]) {
        await act(async () =>
          tabs()
            .find((node) => node.title === label)!
            .click(),
        );
        expect(
          tabs()
            .find((node) => node.title === label)
            ?.getAttribute("aria-selected"),
        ).toBe("true");
        expect(routeWindowDestination).not.toHaveBeenCalled();
      }
      expect(rootNode.querySelector("[data-tool-terminal]")?.getAttribute("data-active")).toBe(
        "false",
      );
      expect(closeOverlay).toHaveBeenCalledWith(false);
      const popout = rootNode.querySelector<HTMLButtonElement>(
        '[aria-label="Open in new window"]',
      )!;
      await act(async () => popout.click());
      expect(routeWindowDestination).toHaveBeenCalledExactlyOnceWith({
        kind: "tool",
        tool: "inbox",
        cwd: "/repo",
        grouped: false,
      });
    } finally {
      await act(async () => root.unmount());
      rootNode.remove();
      vi.unstubAllGlobals();
    }
  },
);
