// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  canCreateListedSession,
  listedRemoteSessionId,
  useNewSessionActions,
  type NewSessionActionDeps,
} from "./useNewSessionActions";
import {
  getSessions,
  resetSessionsStore,
  setSessions,
} from "../../../features/sessions/model/sessionsStore";
import { clearComposerDraft, setComposerDraft } from "../../../features/sessions/model/draftCache";
import {
  rememberRemoteSession,
  remoteSessionFor,
} from "../../../features/connections/model/connections";
import { normalizeSessionPreview } from "../../../features/workspace/model/sessionPreview";
import { setWorktreeFocus } from "../../../features/source-control/model/worktreeFocus";
import { pathKey } from "../../../shared/lib/paths";

it("rejects projects removed, locked or hidden while the selector is open", () => {
  const allowed = new Set([pathKey("/visible"), pathKey("/locked"), pathKey("/hidden")]);
  const lock = {
    lockedGroupIds: new Set(["locked", "hidden"]),
    lockedProjectKeys: new Set([pathKey("/locked"), pathKey("/hidden")]),
  };
  expect(canCreateListedSession("/visible", allowed, lock)).toBe(true);
  expect(canCreateListedSession("/locked", allowed, lock)).toBe(false);
  expect(canCreateListedSession("/hidden", allowed, lock)).toBe(false);
  expect(canCreateListedSession("/removed", allowed, lock)).toBe(false);
});

it("creates only after an explicit project choice and uses that project's worktree", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  resetSessionsStore([]);
  let actions!: ReturnType<typeof useNewSessionActions>;
  const tabsRef: NewSessionActionDeps["tabsRef"] = { current: [] };
  const sessionsRef = { current: getSessions() };
  const deps: NewSessionActionDeps = {
    active: undefined,
    sessionDefaults: undefined,
    projectCwd: "/current",
    sidebarCwd: "/current",
    tabsRef,
    sessionsRef,
    setSessions: (update) => {
      setSessions(update);
      sessionsRef.current = getSessions();
    },
    setTabs: (update) => {
      tabsRef.current = typeof update === "function" ? update(tabsRef.current) : update;
    },
    setSearchViewOpen: vi.fn(),
    setInboxViewOpen: vi.fn(),
    setNotesViewOpen: vi.fn(),
    setAutomationsViewOpen: vi.fn(),
    setSidebarTab: vi.fn(),
    setActiveTabId: vi.fn(),
    setComposerFocused: vi.fn(),
    workspaceNavigation: { cancel: vi.fn() },
    activateTab: vi.fn(),
    appendTab: (tab) => deps.setTabs((tabs) => [...tabs, tab]),
    followProject: vi.fn(),
  };
  function Harness() {
    actions = useNewSessionActions(deps);
    return null;
  }
  setWorktreeFocus("/other", { path: "/worktrees/other", branch: "feature" });
  setWorktreeFocus("remote://host/project", { path: "/remote/worktree", branch: "remote-feature" });
  try {
    act(() => root.render(createElement(Harness)));
    expect(getSessions()).toHaveLength(0);
    act(() => actions.onNewSessionForProject("/other"));
    expect(getSessions()[0]).toMatchObject({
      cwd: "/other",
      worktreeCwd: "/worktrees/other",
      branch: "feature",
    });
    expect(deps.followProject).toHaveBeenLastCalledWith("/other");
    act(() => actions.onNewSessionForProject("/current"));
    act(() => actions.onNewSessionForProject("remote://host/project"));
    expect(getSessions().map((session) => session.cwd)).toEqual([
      "/other",
      "/current",
      "remote://host/project",
    ]);
    expect(getSessions()[2]).toMatchObject({
      worktreeCwd: "/remote/worktree",
      branch: "remote-feature",
    });
    expect(remoteSessionFor(getSessions()[2].id)).toBeUndefined();
    expect(deps.followProject).toHaveBeenLastCalledWith("remote://host/project");
    expect(deps.workspaceNavigation.cancel).toHaveBeenCalledTimes(3);
  } finally {
    setWorktreeFocus("/other", undefined);
    setWorktreeFocus("remote://host/project", undefined);
    act(() => root.unmount());
    resetSessionsStore([]);
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("reuses remote previews while protecting drafts, explicit keep-open and existing sessions", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  resetSessionsStore([]);
  let actions!: ReturnType<typeof useNewSessionActions>;
  const tabsRef: NewSessionActionDeps["tabsRef"] = { current: [] };
  const sessionsRef = { current: getSessions() };
  const deps: NewSessionActionDeps = {
    active: undefined,
    sessionDefaults: undefined,
    projectCwd: "remote://fixture/project",
    sidebarCwd: "remote://fixture/project",
    tabsRef,
    sessionsRef,
    setSessions: (update) => {
      setSessions(update);
      sessionsRef.current = getSessions();
    },
    setTabs: (update) => {
      tabsRef.current = (typeof update === "function" ? update(tabsRef.current) : update).map(
        normalizeSessionPreview,
      );
    },
    setSearchViewOpen: vi.fn(),
    setInboxViewOpen: vi.fn(),
    setNotesViewOpen: vi.fn(),
    setAutomationsViewOpen: vi.fn(),
    setSidebarTab: vi.fn(),
    setActiveTabId: vi.fn(),
    setComposerFocused: vi.fn(),
    workspaceNavigation: { cancel: vi.fn() },
    activateTab: vi.fn(),
    appendTab: (tab) => deps.setTabs((tabs) => [...tabs, tab]),
    followProject: vi.fn(),
  };
  function Harness() {
    actions = useNewSessionActions(deps);
    return null;
  }
  try {
    act(() => root.render(createElement(Harness)));
    for (let index = 0; index < 10; index++) {
      act(() =>
        actions.onSelectRemoteSession(deps.projectCwd, `remote-${index}`, { preview: true }),
      );
    }
    expect(tabsRef.current).toHaveLength(1);
    const draftedId = tabsRef.current[0].focusedId;
    expect(remoteSessionFor(draftedId)).toBe("remote-9");
    setComposerDraft(draftedId, "Unsent remote work");
    act(() => actions.onSelectRemoteSession(deps.projectCwd, "remote-next", { preview: true }));
    expect(tabsRef.current).toHaveLength(2);
    expect(tabsRef.current[0].previewSessionId).toBeUndefined();
    act(() => actions.onSelectRemoteSession(deps.projectCwd, "remote-next"));
    expect(tabsRef.current[1].previewSessionId).toBeUndefined();
    act(() => actions.onSelectRemoteSession(deps.projectCwd, "remote-final", { preview: true }));
    expect(tabsRef.current).toHaveLength(3);
    act(() => actions.onSelectRemoteSession(deps.projectCwd, "remote-9", { preview: true }));
    expect(tabsRef.current).toHaveLength(3);
    expect(deps.activateTab).toHaveBeenLastCalledWith(tabsRef.current[0].id, draftedId);
    const originId = listedRemoteSessionId(sessionsRef.current, deps.projectCwd, draftedId);
    expect(originId).toBe("remote-9");
    act(() => actions.onSelectRemoteSession(deps.projectCwd, originId, { preview: true }));
    expect(tabsRef.current).toHaveLength(3);
    expect(deps.activateTab).toHaveBeenLastCalledWith(tabsRef.current[0].id, draftedId);
    const otherProject = "remote://fixture/other";
    expect(listedRemoteSessionId(sessionsRef.current, otherProject, draftedId)).toBe(draftedId);
    act(() => actions.onSelectRemoteSession(otherProject, "remote-9", { preview: true }));
    expect(remoteSessionFor(tabsRef.current[tabsRef.current.length - 1].focusedId)).toBe(
      "remote-9",
    );
    expect(deps.followProject).toHaveBeenLastCalledWith(otherProject);
  } finally {
    act(() => root.unmount());
    for (const session of getSessions()) {
      clearComposerDraft(session.id);
      rememberRemoteSession(session.id, undefined);
    }
    resetSessionsStore([]);
    container.remove();
    vi.unstubAllGlobals();
  }
});
