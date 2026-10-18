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
vi.mock("../surfaces/lazySurfaces", () => {
  const view = () => createElement(ToolHeader, null, "Tool header");
  return {
    AutomationsView: view,
    InboxView: view,
    NotesView: view,
    SocialView: view,
    TasksView: view,
    ServersView: view,
  };
});

it("switches local tool panels even with an available remote owner and reserves routing for pop-out", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const rootNode = document.createElement("div");
  document.body.append(rootNode);
  const root = createRoot(rootNode);
  const closeOverlay = vi.fn();
  function Workspace() {
    const [state, setState] = useState({
      inboxViewOpen: true,
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
        (value: boolean) => setState((previous) => ({ ...previous, [key]: value })),
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
      toolWindow: null,
      detachedSessionWindow: false,
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
    expect(closeOverlay).toHaveBeenCalledWith(false);
    const popout = rootNode.querySelector<HTMLButtonElement>('[aria-label="Open in new window"]')!;
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
});
