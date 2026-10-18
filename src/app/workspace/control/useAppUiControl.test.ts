// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
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
      onOpenSearch: vi.fn(),
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
      operations: ["status"],
    });
    deps.isDetachedSessionWindow = () => true;
    await act(() => root.render(createElement(Harness)));
    const detached = (await requestAppUi(context, "ui.workspace.list", {})) as { views: unknown[] };
    expect(detached.views).toContainEqual({
      id: "servers",
      available: false,
      operations: ["status"],
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
  } finally {
    await act(() => root.unmount());
    container.remove();
    panel.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
