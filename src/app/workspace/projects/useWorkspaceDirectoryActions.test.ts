// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { newSession, type Session } from "../../../features/sessions/model/session";
import { newTab, type WorkspaceTab } from "../../../features/workspace/model/layout";
import { planProjectReturn } from "../../../features/projects/model/projectReturn";
import {
  saveHostSessionBinding,
  hostSessionBinding,
} from "../../../features/connections/model/sessionExecutionBinding";
import {
  setProjectDefaultProvider,
  setProjectDefaultModel,
  setProjectSessionDefaults,
} from "../../../features/sessions/model/projectProviders";
import {
  useWorkspaceDirectoryActions,
  type WorkspaceDirectoryActionsDeps,
} from "./useWorkspaceDirectoryActions";
import { useProjectOpen, type ProjectOpenDeps } from "./useProjectOpen";
import { loadRecents } from "../../../features/projects/model/recents";

const effects = vi.hoisted(() => ({
  forget: vi.fn(),
  keep: vi.fn(),
  review: vi.fn(),
  git: vi.fn(),
  persist: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock("../../../integrations/harness", async (original) => ({
  ...(await original<typeof import("../../../integrations/harness")>()),
  forgetHarnessSession: effects.forget,
}));
vi.mock("../../../features/sessions/model/checkpoint", async (original) => ({
  ...(await original<typeof import("../../../features/sessions/model/checkpoint")>()),
  keepSessionChanges: effects.keep,
  notifyReviewChanged: effects.review,
}));
vi.mock("../../../platform/tauri/fs", async (original) => ({
  ...(await original<typeof import("../../../platform/tauri/fs")>()),
  notifyGitChanged: effects.git,
}));
vi.mock("../../../features/sync/model/syncRemoteProjects", () => ({
  openSyncedProjectRemotely: vi.fn(),
}));

let root: Root;
let directory: ReturnType<typeof useWorkspaceDirectoryActions>;
let projects: ReturnType<typeof useProjectOpen>;
let deps: WorkspaceDirectoryActionsDeps;
let tabsRef: { current: WorkspaceTab[] };
let activeTabIdRef: { current: string };
let cwdChanges: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  vi.clearAllMocks();
  effects.forget.mockResolvedValue(undefined);
  effects.keep.mockResolvedValue(undefined);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

function hostSession(created = false) {
  const source = {
    ...newSession("codex", "G:/alpha"),
    worktreeCwd: "G:/alpha-worktree",
    branch: "topic",
    providerAccountId: "host-profile",
    workspaceMode: "worktree" as const,
    worktreeBase: "main",
  };
  return saveHostSessionBinding(source, {
    kind: "local-host",
    machineId: "local",
    environmentId: "home",
    projectId: "host-alpha",
    sessionId: source.id,
    authorityGeneration: null,
    created,
  });
}

function configureDestination() {
  setProjectDefaultProvider("G:/beta", "claude");
  setProjectDefaultModel("G:/beta", "claude", "claude:opus-4.6");
  setProjectSessionDefaults("G:/beta", "claude", { runtimeMode: "auto-accept-edits" });
}

async function mount(session: Session) {
  const tab = newTab(session.id);
  tabsRef = { current: [tab] };
  activeTabIdRef = { current: tab.id };
  const sessionsRef = { current: [session] };
  deps = {
    activeTab: tab,
    onFocusPane: vi.fn(),
    windowTransferPendingRef: { current: false },
    movingTabIds: { current: new Set() },
    setTabs: (update) => {
      tabsRef.current = typeof update === "function" ? update(tabsRef.current) : update;
    },
    sessionsRef,
    setProjectCwd: vi.fn(),
    setRecents: vi.fn(),
    setSessions: (update) => {
      sessionsRef.current = typeof update === "function" ? update(sessionsRef.current) : update;
    },
    projectOfTab: (id) =>
      sessionsRef.current.find(
        (entry) => entry.id === tabsRef.current.find((entry) => entry.id === id)?.focusedId,
      )?.cwd,
    appendTab: vi.fn((next) => {
      tabsRef.current = [...tabsRef.current, next];
    }),
    setActiveTabId: vi.fn((id) => {
      activeTabIdRef.current = id;
    }),
    setComposerFocused: vi.fn(),
    persistSession: effects.persist,
    sidebarCwdRef: { current: session.cwd },
    workspaceNavigation: { selectWorkspace: vi.fn() },
  };
  const navigation = { cancel: vi.fn(), selectProject: vi.fn() };
  function Fixture() {
    directory = useWorkspaceDirectoryActions(deps);
    cwdChanges = vi.fn((id: string, path: string) => directory.onCwdChange(id, path));
    projects = useProjectOpen({
      readProjectReturnMemory: () => new Map(),
      tabsRef,
      sessionsRef,
      activeTabIdRef,
      setSearchViewOpen: vi.fn(),
      setInboxViewOpen: vi.fn(),
      setNotesViewOpen: vi.fn(),
      setAutomationsViewOpen: vi.fn(),
      onCwdChange: cwdChanges,
      setSessions: deps.setSessions,
      setTabs: deps.setTabs,
      insertBeside: (tabs, next) => [...tabs, next],
      setProjectCwd: deps.setProjectCwd,
      activateTab: vi.fn(),
      setActiveTabId: deps.setActiveTabId,
      setComposerFocused: deps.setComposerFocused,
      setRecents: deps.setRecents,
      workspaceNavigation: navigation,
    } satisfies ProjectOpenDeps);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Fixture)));
}

function expectHostUntouched(source: Session) {
  expect(deps.sessionsRef.current.find((session) => session.id === source.id)).toBe(source);
  expect(source).toMatchObject({
    cwd: "G:/alpha",
    worktreeCwd: "G:/alpha-worktree",
    branch: "topic",
    providerAccountId: "host-profile",
    workspaceMode: "worktree",
    worktreeBase: "main",
  });
  expect(hostSessionBinding(source)?.projectId).toBe("host-alpha");
  expect(effects.forget).not.toHaveBeenCalled();
  expect(effects.keep).not.toHaveBeenCalled();
  expect(effects.persist).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
}

it("plans and opens a different project from a blank Host tab without retargeting the owner", async () => {
  configureDestination();
  const source = hostSession();
  await mount(source);
  expect(
    planProjectReturn({
      memory: new Map(),
      tabs: tabsRef.current,
      sessions: deps.sessionsRef.current,
      activeTabId: activeTabIdRef.current,
      projectPath: "G:/beta",
    }),
  ).toEqual({ action: "create" });
  await act(async () => projects.onSelectProject("G:/beta"));
  expect(cwdChanges).not.toHaveBeenCalled();
  expectHostUntouched(source);
  const next = deps.sessionsRef.current.find((session) => session.id !== source.id)!;
  expect(next).toMatchObject({
    cwd: "G:/beta",
    harness: "claude",
    model: "claude:opus-4.6",
    runtimeMode: "auto-accept-edits",
    blocks: [],
  });
  expect(hostSessionBinding(next)).toBeUndefined();
  expect(next.providerAccountId).toBeUndefined();
  expect(tabsRef.current).toHaveLength(2);
  expect(activeTabIdRef.current).not.toBe(tabsRef.current[0].id);
});

it("settles Room project selection only after the canonical recents mutation", async () => {
  configureDestination();
  const source = hostSession();
  await mount(source);
  await act(async () => {
    await projects.onSelectProject("G:/beta", "native-pending");
  });
  expect(loadRecents().some((project) => project.path === "G:/beta")).toBe(true);
  expectHostUntouched(source);
});

it("guards a direct cwd change using a durable owner even when the in-memory binding field is absent", async () => {
  configureDestination();
  const bound = hostSession();
  const source = { ...bound };
  delete source.hostBinding;
  await mount(source);
  await act(async () => directory.onCwdChange(source.id, "G:/beta"));
  expectHostUntouched(source);
  const next = deps.sessionsRef.current.find((session) => session.id !== source.id)!;
  expect(next).toMatchObject({ cwd: "G:/beta", harness: "claude", model: "claude:opus-4.6" });
  expect(hostSessionBinding(next)).toBeUndefined();
  expect(deps.appendTab).toHaveBeenCalledOnce();
  expect(effects.review).not.toHaveBeenCalled();
});

it("keeps same-project Host worktree state and rejects global Native branch/mode/base callbacks", async () => {
  const source = {
    ...hostSession(true),
    providerSessionId: "host-thread",
    context: { used: 5, window: 20 },
  };
  await mount(source);
  await act(async () => {
    directory.onCwdChange(source.id, "g:\\ALPHA\\");
    directory.onBranchChange(source.id);
    directory.onWorkspaceModeChange(source.id, "current");
    directory.onWorktreeBaseChange(source.id, "other-base");
    projects.onSelectProject("G:/alpha");
  });
  expectHostUntouched(source);
  expect(source.providerSessionId).toBe("host-thread");
  expect(source.context).toEqual({ used: 5, window: 20 });
  expect(deps.sessionsRef.current).toHaveLength(1);
  expect(deps.appendTab).not.toHaveBeenCalled();
  expect(effects.git).not.toHaveBeenCalled();
  expect(effects.review).not.toHaveBeenCalled();
});

it("retains Native blank reuse and its target project defaults through the same open chain", async () => {
  configureDestination();
  const source = { ...newSession("codex", "G:/alpha"), composerSeed: "Keep this draft" };
  await mount(source);
  await act(async () => projects.onSelectProject("G:/beta"));
  expect(cwdChanges).toHaveBeenCalledWith(source.id, "G:/beta");
  expect(deps.sessionsRef.current).toHaveLength(1);
  expect(deps.sessionsRef.current[0]).toMatchObject({
    id: source.id,
    cwd: "G:/beta",
    harness: "claude",
    model: "claude:opus-4.6",
    composerSeed: "Keep this draft",
  });
  expect(tabsRef.current).toHaveLength(1);
  expect(effects.keep).toHaveBeenCalledWith(source.id, "G:/alpha");
});

it("retains Native branch retirement and workspace mode/base callbacks", async () => {
  const source = {
    ...newSession("codex", "G:/alpha"),
    providerSessionId: "native-thread",
    branch: "topic",
    context: { used: 5, window: 20 },
  };
  await mount(source);
  await act(async () => directory.onBranchChange(source.id));
  expect(effects.forget).toHaveBeenCalledWith("codex", source.id);
  expect(effects.persist).toHaveBeenCalledWith(
    expect.objectContaining({
      id: source.id,
      providerSessionId: undefined,
      branch: undefined,
      context: undefined,
    }),
  );
  await act(async () => {
    directory.onWorkspaceModeChange(source.id, "worktree", "main");
    directory.onWorktreeBaseChange(source.id, "develop");
  });
  expect(deps.sessionsRef.current[0]).toMatchObject({
    workspaceMode: "worktree",
    worktreeBase: "develop",
  });
  expect(effects.git).toHaveBeenCalledOnce();
});
