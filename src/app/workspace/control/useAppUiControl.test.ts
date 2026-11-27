// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { setCrewsPageOpen } from "../../../features/crews/model/crewsPage";
import { requestAppUi } from "../../model/appUiControl";
import { useAppUiControl, type AppUiControlDeps } from "./useAppUiControl";

vi.mock("../../../features/social/ui/SocialShortcut", () => ({ SOCIAL_PANEL_EVENT: "social" }));
vi.mock("../../../features/group-lock/model/groupLock", () => ({
  getGroupLockView: () => ({ lock: null }),
}));
vi.mock("../../../features/group-lock/model/lockState", () => ({ isProjectLockedIn: () => false }));
vi.mock("../../../features/projects/model/recents", () => ({ canOpenTerminalIn: () => true }));
vi.mock("../../../features/settings/model/settings", () => ({ loadNotesEnabled: () => true }));
vi.mock("../../../features/sessions/model/sessionsStore", () => ({
  sessionsRef: { current: [{ id: "owner", cwd: "/project" }] },
}));

it("reports Servers foreground and its actual mount instead of a retained conversation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const panel = document.createElement("section");
  panel.dataset.appServers = "";
  document.body.append(panel);
  const rects = vi.spyOn(panel, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  const deps: AppUiControlDeps = {
    surface: {
      settingsOpen: false,
      searchViewOpen: false,
      searchDialogOpen: false,
      inboxViewOpen: false,
      notesViewOpen: false,
      serversViewOpen: true,
      automationsViewOpen: false,
      socialBoardShown: false,
      taskBoardShown: false,
      settingsSection: "connections",
      projectCwd: "/project",
      activeTab: {
        kind: "session",
        focusedId: "owner",
      } as AppUiControlDeps["surface"]["activeTab"],
      sessionSidebarOpen: false,
      sidebarTab: "sessions",
      dockVisible: false,
    },
    actions: {
      setSettingsOpen: vi.fn(),
      setSearchViewOpen: vi.fn(),
      onLeaveSearch: vi.fn(),
      setInboxViewOpen: vi.fn(),
      setNotesViewOpen: vi.fn(),
      setAutomationsViewOpen: vi.fn(),
      setServersViewOpen: vi.fn(),
      setSessionSidebarOpen: vi.fn(),
      setSidebarTab: vi.fn(),
      onShowProjectTerminal: vi.fn(),
      onHideProjectTerminal: vi.fn(),
      onOpenNotes: vi.fn(),
      onOpenInbox: vi.fn(),
      onOpenAutomations: vi.fn(),
      onOpenTasks: vi.fn(),
      setAuxiliaryTool: vi.fn(),
      onOpenCrews: vi.fn(),
      openSettings: vi.fn(),
    },
    focusOpenSession: vi.fn(),
    isDetachedSessionWindow: () => false,
  };
  const context = { cwd: "/project", sessionId: "owner", title: "Owner" };
  const root = createRoot(container);
  function Harness() {
    useAppUiControl(deps);
    return null;
  }
  try {
    await act(() => root.render(createElement(Harness)));
    await expect(requestAppUi(context, "ui.workspace.status", {})).resolves.toMatchObject({
      view: "servers",
      mounted: true,
      sessionId: "owner",
      terminalOpen: false,
    });
    const listing = (await requestAppUi(context, "ui.workspace.list", {})) as { views: unknown[] };
    expect(listing.views).toContainEqual({
      id: "servers",
      available: true,
      operations: ["open", "close", "status"],
    });
    deps.isDetachedSessionWindow = () => true;
    await act(() => root.render(createElement(Harness)));
    const detached = (await requestAppUi(context, "ui.workspace.list", {})) as { views: unknown[] };
    expect(detached.views).toContainEqual({
      id: "servers",
      available: false,
      operations: ["open", "close", "status"],
    });
    deps.isDetachedSessionWindow = () => false;
    rects.mockReturnValue([] as unknown as DOMRectList);
    await expect(requestAppUi(context, "ui.workspace.status", {})).resolves.toMatchObject({
      view: "servers",
      mounted: false,
    });
    deps.surface.serversViewOpen = false;
    await act(() => root.render(createElement(Harness)));
    await expect(requestAppUi(context, "ui.workspace.status", {})).resolves.toMatchObject({
      view: "conversation",
      mounted: true,
      sessionId: "owner",
    });
    expect(deps.focusOpenSession).not.toHaveBeenCalled();
    for (const callback of Object.values(deps.actions)) expect(callback).not.toHaveBeenCalled();
    await expect(
      requestAppUi(context, "terminals.create", { requestId: "create" }),
    ).rejects.toThrow("unavailable");
    deps.isDetachedSessionWindow = () => true;
    await act(() => root.render(createElement(Harness)));
    await expect(requestAppUi(context, "ui.workspace.open", { view: "servers" })).rejects.toThrow(
      "unavailable",
    );
    deps.isDetachedSessionWindow = () => false;
    rects.mockReturnValue([{}] as unknown as DOMRectList);
    deps.actions.onOpenServers = vi.fn(() => {
      deps.surface.serversViewOpen = true;
      act(() => root.render(createElement(Harness)));
    });
    deps.actions.setServersViewOpen = vi.fn((value) => {
      deps.surface.serversViewOpen = value as boolean;
      act(() => root.render(createElement(Harness)));
    });
    await act(() => root.render(createElement(Harness)));
    await expect(
      requestAppUi(context, "ui.workspace.open", { view: "servers" }),
    ).resolves.toMatchObject({ view: "servers", mounted: true, sessionId: "owner" });
    expect(deps.actions.onOpenServers).toHaveBeenCalledOnce();
    await expect(
      requestAppUi(context, "ui.workspace.close", { view: "servers" }),
    ).resolves.toMatchObject({ view: "conversation", sessionId: "owner" });
    expect(deps.focusOpenSession).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
    container.remove();
    panel.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("reports Crews and auxiliary tool pages by their own view names", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const crewsPanel = document.createElement("section");
  crewsPanel.dataset.appCrews = "";
  document.body.append(crewsPanel);
  vi.spyOn(crewsPanel, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  const deps: AppUiControlDeps = {
    surface: {
      settingsOpen: false,
      searchViewOpen: false,
      searchDialogOpen: false,
      inboxViewOpen: false,
      notesViewOpen: false,
      serversViewOpen: true,
      automationsViewOpen: false,
      socialBoardShown: false,
      taskBoardShown: false,
      auxiliaryTool: null,
      settingsSection: "connections",
      projectCwd: "/project",
      activeTab: {
        kind: "session",
        focusedId: "owner",
      } as AppUiControlDeps["surface"]["activeTab"],
      sessionSidebarOpen: false,
      sidebarTab: "sessions",
      dockVisible: false,
    },
    actions: {
      setSettingsOpen: vi.fn(),
      setSearchViewOpen: vi.fn(),
      onLeaveSearch: vi.fn(),
      setInboxViewOpen: vi.fn(),
      setNotesViewOpen: vi.fn(),
      setAutomationsViewOpen: vi.fn(),
      setServersViewOpen: vi.fn(),
      setSessionSidebarOpen: vi.fn(),
      setSidebarTab: vi.fn(),
      onShowProjectTerminal: vi.fn(),
      onHideProjectTerminal: vi.fn(),
      onOpenNotes: vi.fn(),
      onOpenInbox: vi.fn(),
      onOpenAutomations: vi.fn(),
      onOpenTasks: vi.fn(),
      setAuxiliaryTool: vi.fn(),
      onOpenCrews: vi.fn(),
      openSettings: vi.fn(),
    },
    focusOpenSession: vi.fn(),
    isDetachedSessionWindow: () => false,
  };
  const context = { cwd: "/project", sessionId: "owner", title: "Owner" };
  const root = createRoot(container);
  function Harness() {
    useAppUiControl(deps);
    return null;
  }
  try {
    setCrewsPageOpen(true);
    await act(() => root.render(createElement(Harness)));
    await expect(requestAppUi(context, "ui.workspace.status", {})).resolves.toMatchObject({
      view: "crews",
      mounted: true,
    });
    setCrewsPageOpen(false);
    deps.surface.serversViewOpen = false;
    deps.surface.automationsViewOpen = true;
    deps.surface.auxiliaryTool = "assistant";
    await act(() => root.render(createElement(Harness)));
    await expect(requestAppUi(context, "ui.workspace.status", {})).resolves.toMatchObject({
      view: "assistant",
      mounted: true,
    });
    deps.surface.auxiliaryTool = "terminal";
    await act(() => root.render(createElement(Harness)));
    await expect(requestAppUi(context, "ui.workspace.status", {})).resolves.toMatchObject({
      view: "terminal",
    });
  } finally {
    setCrewsPageOpen(false);
    await act(() => root.unmount());
    container.remove();
    crewsPanel.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("opens Settings and closes it again for both the conversation and the window scope", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const panel = document.createElement("section");
  panel.dataset.appSettings = "";
  document.body.append(panel);
  vi.spyOn(panel, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  const deps: AppUiControlDeps = {
    surface: {
      settingsOpen: false,
      searchViewOpen: false,
      searchDialogOpen: false,
      inboxViewOpen: false,
      notesViewOpen: false,
      serversViewOpen: false,
      automationsViewOpen: false,
      socialBoardShown: false,
      taskBoardShown: false,
      settingsSection: "connections",
      projectCwd: "/project",
      activeTab: {
        kind: "session",
        focusedId: "owner",
      } as AppUiControlDeps["surface"]["activeTab"],
      sessionSidebarOpen: false,
      sidebarTab: "sessions",
      dockVisible: false,
    },
    actions: {
      setSettingsOpen: vi.fn(),
      setSearchViewOpen: vi.fn(),
      onLeaveSearch: vi.fn(),
      setInboxViewOpen: vi.fn(),
      setNotesViewOpen: vi.fn(),
      setAutomationsViewOpen: vi.fn(),
      setSessionSidebarOpen: vi.fn(),
      setSidebarTab: vi.fn(),
      onShowProjectTerminal: vi.fn(),
      onHideProjectTerminal: vi.fn(),
      onOpenNotes: vi.fn(),
      onOpenInbox: vi.fn(),
      onOpenAutomations: vi.fn(),
      onOpenTasks: vi.fn(),
      setAuxiliaryTool: vi.fn(),
      onOpenCrews: vi.fn(),
      openSettings: vi.fn(),
    },
    focusOpenSession: vi.fn(),
    isDetachedSessionWindow: () => false,
  };
  const root = createRoot(container);
  function Harness() {
    useAppUiControl(deps);
    return null;
  }
  const rerender = () => act(() => root.render(createElement(Harness)));
  deps.actions.openSettings = vi.fn((section) => {
    deps.surface.settingsOpen = true;
    if (section) deps.surface.settingsSection = section;
    void rerender();
  });
  deps.actions.setSettingsOpen = vi.fn((value) => {
    deps.surface.settingsOpen = value as boolean;
    void rerender();
  });
  const conversation = { cwd: "/project", sessionId: "owner", title: "Owner" };
  const room = { cwd: "/project", window: true as const, title: "Room" };
  try {
    await rerender();
    for (const context of [conversation, room]) {
      await expect(
        requestAppUi(context, "ui.workspace.open", { view: "settings", section: "voice" }),
      ).resolves.toMatchObject({ view: "settings", section: "voice", mounted: true });
      await expect(
        requestAppUi(context, "ui.workspace.close", { view: "settings" }),
      ).resolves.toMatchObject({
        view: "conversation",
      });
    }
    expect(deps.actions.openSettings).toHaveBeenCalledTimes(2);
    expect(deps.actions.setSettingsOpen).toHaveBeenCalledWith(false);
    expect(deps.focusOpenSession).not.toHaveBeenCalled();
    await expect(requestAppUi(room, "ui.workspace.open", { view: "servers" })).rejects.toThrow(
      "unavailable",
    );
  } finally {
    await act(() => root.unmount());
    container.remove();
    panel.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("serves the projectless Room with global views only and leaves inactive views alone", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const settingsPanel = document.createElement("section");
  settingsPanel.dataset.appSettings = "";
  document.body.append(settingsPanel);
  vi.spyOn(settingsPanel, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  const deps: AppUiControlDeps = {
    surface: {
      settingsOpen: false,
      searchViewOpen: false,
      searchDialogOpen: false,
      inboxViewOpen: false,
      notesViewOpen: false,
      serversViewOpen: false,
      automationsViewOpen: false,
      socialBoardShown: false,
      taskBoardShown: false,
      settingsSection: "general",
      projectCwd: "/locked",
      activeTab: null,
      sessionSidebarOpen: false,
      sidebarTab: "sessions",
      dockVisible: false,
    },
    actions: {
      setSettingsOpen: vi.fn((value: boolean | ((previous: boolean) => boolean)) => {
        deps.surface.settingsOpen =
          typeof value === "function" ? value(deps.surface.settingsOpen) : value;
        void rerender();
      }),
      setSearchViewOpen: vi.fn(),
      onLeaveSearch: vi.fn(),
      setInboxViewOpen: vi.fn(),
      setNotesViewOpen: vi.fn(),
      setAutomationsViewOpen: vi.fn(),
      setServersViewOpen: vi.fn(),
      setAuxiliaryTool: vi.fn(),
      setSessionSidebarOpen: vi.fn(),
      setSidebarTab: vi.fn(),
      onShowProjectTerminal: vi.fn(),
      onHideProjectTerminal: vi.fn(),
      onOpenNotes: vi.fn(),
      onOpenInbox: vi.fn(),
      onOpenAutomations: vi.fn(),
      onOpenTasks: vi.fn(),
      onOpenCrews: vi.fn(),
      openSettings: vi.fn((section?: string) => {
        deps.surface.settingsSection = (section ??
          "general") as AppUiControlDeps["surface"]["settingsSection"];
        deps.surface.settingsOpen = true;
        void rerender();
      }),
    },
    focusOpenSession: vi.fn(),
    isDetachedSessionWindow: () => false,
  };
  const root = createRoot(container);
  function Harness() {
    useAppUiControl(deps);
    return null;
  }
  const rerender = () => act(() => root.render(createElement(Harness)));
  const room = { global: true as const, title: "Room" };
  try {
    await rerender();
    deps.surface.searchDialogOpen = true;
    deps.actions.onLeaveSearch = vi.fn(() => {
      deps.surface.searchDialogOpen = false;
      void rerender();
    });
    await rerender();
    await expect(requestAppUi(room, "ui.workspace.status", {})).resolves.toMatchObject({
      view: "search",
    });
    await expect(
      requestAppUi(room, "ui.workspace.close", { view: "search" }),
    ).resolves.toMatchObject({
      view: "conversation",
    });
    expect(deps.actions.onLeaveSearch).toHaveBeenCalledOnce();
    await expect(
      requestAppUi(room, "ui.workspace.open", { view: "settings", section: "voice" }),
    ).resolves.toMatchObject({ view: "settings", section: "voice", mounted: true });
    expect(deps.actions.openSettings).toHaveBeenCalledWith("voice");
    await expect(requestAppUi(room, "ui.workspace.open", { view: "tasks" })).rejects.toThrow(
      "field",
    );
    await expect(requestAppUi(room, "ui.workspace.close", { view: "crews" })).rejects.toThrow(
      "field",
    );
    // Closing an inactive global view changes nothing and reads back the screen on display.
    await expect(
      requestAppUi(room, "ui.workspace.close", { view: "inbox" }),
    ).resolves.toMatchObject({ view: "settings" });
    expect(deps.actions.setInboxViewOpen).not.toHaveBeenCalled();
    expect(deps.actions.onOpenCrews).not.toHaveBeenCalled();
    await expect(requestAppUi(room, "terminals.create", { requestId: "r" })).rejects.toThrow(
      "Unsupported workspace UI request.",
    );
    await expect(
      requestAppUi(room, "ui.workspace.close", { view: "settings" }),
    ).resolves.toMatchObject({ view: "conversation" });
    expect(deps.actions.setSettingsOpen).toHaveBeenCalledWith(false);
    expect(deps.focusOpenSession).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
    container.remove();
    settingsPanel.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
