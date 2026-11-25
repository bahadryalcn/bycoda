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
vi.mock("../../../features/assistant/model/assistantClient", async (original) => ({
  ...(await original<typeof import("../../../features/assistant/model/assistantClient")>()),
  useAssistantIdentity: () => ({ title: "Assistant Arif", room: "Room · Arif" }),
}));
const assistantFailure = vi.hoisted(() => ({ failing: false }));
vi.mock("../surfaces/lazySurfaces", () => {
  const view = () => createElement(ToolHeader, null, "Tool header");
  return {
    preloadToolSurface: vi.fn(),
    AutomationsView: view,
    AssistantView: () => {
      if (assistantFailure.failing) throw new Error("Assistant chunk failed");
      return view();
    },
    InboxView: ({ cwd }: { cwd: string }) =>
      createElement("div", { "data-inbox-project": cwd }, view()),
    LiveStreamView: view,
    NotesView: view,
    SocialView: view,
    TasksView: view,
    ServersView: view,
    CrewsView: view,
  };
});

it.each([false, true])(
  "switches tools locally without offering or mounting a standalone terminal (detached: %s)",
  async (detached) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const rootNode = document.createElement("div");
    document.body.append(rootNode);
    const root = createRoot(rootNode);
    const closeOverlay = vi.fn();
    function Workspace() {
      const [state, setState] = useState({
        inboxViewOpen: true,
        auxiliaryTool: null as "terminal" | "conversation-tools" | "assistant" | null,
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
        sidebarCwd: "/previous-repo",
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
      expect(
        rootNode.querySelector("[data-inbox-project]")?.getAttribute("data-inbox-project"),
      ).toBe("/repo");
      for (const label of [
        "Notes",
        "Tasks",
        "Social Media",
        "Automations",
        "Room · Arif",
        "Inbox",
        "Servers",
        "Conversation tools",
        "Inbox",
      ]) {
        await act(async () =>
          tabs()
            .find((node) => node.textContent === label)!
            .click(),
        );
        expect(
          tabs()
            .find((node) => node.textContent === label)
            ?.getAttribute("aria-selected"),
        ).toBe("true");
        expect(routeWindowDestination).not.toHaveBeenCalled();
      }
      expect(tabs().some((tab) => tab.textContent === "Terminal")).toBe(false);
      expect(rootNode.querySelector("[data-tool-terminal]")).toBeNull();
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

it("contains an Assistant panel failure and recovers without touching neighbouring panels", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const rootNode = document.createElement("div");
  document.body.append(rootNode);
  const root = createRoot(rootNode);
  const onLeave = vi.fn();
  function Workspace() {
    const [state, setState] = useState({
      inboxViewOpen: true,
      auxiliaryTool: null as "assistant" | null,
      automationsViewOpen: false,
    });
    const noop = () => {};
    return createElement(WorkspaceToolPanels, {
      ...state,
      notesViewOpen: false,
      serversViewOpen: false,
      socialBoardShown: false,
      taskBoardShown: false,
      pullRequestsOnly: false,
      setInboxViewOpen: (value: boolean) => setState((p) => ({ ...p, inboxViewOpen: value })),
      setAutomationsViewOpen: (value: boolean) =>
        setState((p) => ({ ...p, automationsViewOpen: value })),
      setAuxiliaryTool: (value: "assistant" | null) =>
        setState((p) => ({ ...p, auxiliaryTool: value })),
      setFilePickerOpen: noop,
      setSettingsOpen: noop,
      setSearchViewOpen: noop,
      setPullRequestsOnly: noop,
      setNotesViewOpen: noop,
      setServersViewOpen: noop,
      setSocialBoardShown: noop,
      setTaskBoardShown: noop,
      onLeaveAutomations: () => {
        onLeave();
        setState((p) => ({ ...p, automationsViewOpen: false, auxiliaryTool: null }));
      },
      projectCwd: "/repo",
      socialPanelCwd: "",
      sidebarCwd: "/repo",
      visibleRecents: [],
      notesEnabled: true,
      toolWindow: null,
      detachedSessionWindow: false,
      projectRailOpen: false,
      compactProjectRail: false,
      compactRailActive: false,
    } as unknown as WorkspaceToolPanelsProps);
  }
  const click = (label: string) =>
    act(async () =>
      [...rootNode.querySelectorAll<HTMLButtonElement>('[role="tab"], button')]
        .find((node) => node.textContent === label)!
        .click(),
    );
  try {
    assistantFailure.failing = true;
    await act(async () => root.render(createElement(Workspace)));
    await click("Room · Arif");
    // The failure stays inside the Assistant panel: its own recovery view and h1, no workspace-level crash.
    expect(rootNode.textContent).toContain("This view could not be displayed");
    expect(
      [...rootNode.querySelectorAll("h1")].some((node) => node.textContent === "Assistant"),
    ).toBe(true);
    expect(rootNode.querySelector("[role=tab]")).not.toBeNull();
    // Retry remounts the panel once the cause is gone.
    assistantFailure.failing = false;
    await click("Try again");
    expect(rootNode.textContent).not.toContain("This view could not be displayed");
    // The recovered view mounts again; its ToolHeader renders the tool tabs, not the fixture text.
    expect(rootNode.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      "Room · Arif",
    );
    // A second failure leaves through Back to workspace.
    assistantFailure.failing = true;
    await act(async () => root.render(createElement(Workspace)));
    await click("Inbox");
    await click("Room · Arif");
    await click("Back to workspace");
    expect(onLeave).toHaveBeenCalled();
  } finally {
    assistantFailure.failing = false;
    consoleError.mockRestore();
    await act(async () => root.unmount());
    rootNode.remove();
    vi.unstubAllGlobals();
  }
});
