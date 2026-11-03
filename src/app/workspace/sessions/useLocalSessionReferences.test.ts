// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newDefaultSession, type Session } from "../../../features/sessions/model/session";
import { getSessions, resetSessionsStore } from "../../../features/sessions/model/sessionsStore";
import {
  clearComposerDraft,
  getComposerDraft,
  setComposerDraft,
} from "../../../features/sessions/model/draftCache";
import { leafIds, newTab, type WorkspaceTab } from "../../../features/workspace/model/layout";
import {
  restoreHostSessionShell,
  saveHostSessionBinding,
} from "../../../features/connections/model/sessionExecutionBinding";
import {
  clearTranscriptJump,
  peekTranscriptJump,
} from "../../../features/sessions/model/transcriptJump";
import type { ResolvedLocalSession } from "../../../features/sessions/model/localSessionNavigation";
import type { LocalSessionReference } from "../../../features/sessions/model/localSessionReference";
import { useOpenSessionActions, type OpenSessionActionsDeps } from "./useOpenSessionActions";
import { useOrchestrationWorkerPanes } from "../bridges/useOrchestrationWorkerPanes";
import type { WorkerDetailRequest } from "../bridges/useOrchestrationState";
import { hostSessionShellSummaries } from "../../../features/connections/model/sessionExecutionBinding";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  getSession: vi.fn(),
  loadRemoteBlock: vi.fn(),
  sessionAccessForMachine: vi.fn(),
  privacy: { lock: {} },
  locked: false,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: vi.fn(async () => undefined),
}));
vi.mock("../../../features/group-lock/model/groupLock", () => ({
  getGroupLockView: () => mocks.privacy,
  subscribeGroupLock: () => () => {},
}));
vi.mock("../../../features/group-lock/model/lockState", () => ({
  isProjectLockedIn: () => mocks.locked,
}));
vi.mock("../../../features/sessions/model/localSessionNavigation", () => ({
  resolveLocalSessionReference: mocks.resolve,
  assertReferenceProjectVisible: () => {
    if (mocks.locked) throw new Error("locked");
  },
}));
vi.mock("../../../features/sessions/data/sessionStore", () => ({
  getSession: mocks.getSession,
}));
vi.mock("../../../features/connections/model/connections", () => ({
  loadRemoteBlock: mocks.loadRemoteBlock,
  sessionAccessForMachine: mocks.sessionAccessForMachine,
}));
import { useLocalSessionReferences } from "./useLocalSessionReferences";

let root: Root;
let container: HTMLDivElement;
let navigation: ReturnType<typeof useLocalSessionReferences>;
let deps: OpenSessionActionsDeps;
let showSessions: ReturnType<typeof vi.fn>;
let source: Session;
let target: Session;
let active: string;
let epoch: number;
let mounted: boolean;

const reference: LocalSessionReference = {
  locator: {
    kind: "native",
    sourceStoreId: "store",
    sourceProfileId: "profile",
    sessionId: "target",
  },
};
const nativeTarget = (): ResolvedLocalSession => ({
  locator: reference.locator,
  title: "Target",
  cwd: "/project",
  archived: true,
});
const hostTarget = (): ResolvedLocalSession => ({
  locator: {
    kind: "host",
    environmentId: "local-env",
    sessionId: "host-target",
  },
  title: "Host target",
  cwd: "/project",
  archived: true,
  host: {
    machine: { id: "machine", environmentId: "local-env" } as never,
    project: { id: "project", cwd: "/project", name: "Project" },
    snapshot: {
      session: { ...target, id: "host-target" },
      projectId: "project",
      revision: 7,
      status: "idle",
      archived: true,
    },
  },
});

function Harness() {
  const open = useOpenSessionActions(deps);
  const [workerDetailRequest, setWorkerDetailRequest] = useState<WorkerDetailRequest | null>(null);
  const { queueWorkerPanes } = useOrchestrationWorkerPanes({
    tabs: deps.tabsRef.current,
    setTabs: deps.setTabs,
    setActiveTabId: deps.setActiveTabId,
    setComposerFocused: deps.setComposerFocused,
    projectCwdRef: { current: "/project" },
    focusOpenSession: deps.focusOpenSession,
    onSelectHistorySession: open.onSelectHistorySession,
    ensureOpenSession: deps.ensureOpenSession,
    inspectedWorkerId: null,
    setInspectedWorkerId: deps.setInspectedWorkerId,
    workerDetailRequest,
    setWorkerDetailRequest,
  });
  navigation = useLocalSessionReferences({
    ...open,
    ensureOpenSession: deps.ensureOpenSession,
    activeSessionId: () => deps.tabsRef.current.find((tab) => tab.id === active)?.focusedId,
    showSessions,
    workspaceNavigation: deps.workspaceNavigation,
    onOpenWorkerDetails: (session, isCurrent) =>
      queueWorkerPanes(
        [
          {
            sessionId: session.id,
            leadId: session.orchestrationLeadId!,
            title: session.title,
            harness: session.harness,
          },
        ],
        isCurrent,
      ),
  });
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  localStorage.clear();
  mocks.privacy = { lock: {} };
  mocks.locked = false;
  epoch = 0;
  source = { ...newDefaultSession("/project"), id: "source", title: "Source" };
  target = { ...newDefaultSession("/project"), id: "target", title: "Target" };
  resetSessionsStore([source, target]);
  const tabsRef = { current: [newTab(source.id)] as WorkspaceTab[] };
  active = tabsRef.current[0].id;
  showSessions = vi.fn();
  deps = {
    sessions: [source, target],
    tabsRef,
    setTabs: (update) => {
      tabsRef.current = typeof update === "function" ? update(tabsRef.current) : update;
    },
    setActiveTabId: (id) => {
      active = id;
    },
    setProjectTerminalFocused: vi.fn(),
    setComposerFocused: vi.fn(),
    setInspectedWorkerId: vi.fn(),
    followProject: vi.fn(),
    appendTab: (tab) => {
      tabsRef.current = [...tabsRef.current, tab];
    },
    insertBesideActive: (tabs, tab) => [...tabs, tab],
    ensureOpenSession: vi.fn(
      async (id) =>
        getSessions().find((session) => session.id === id) ?? restoreHostSessionShell(id) ?? null,
    ),
    focusOpenSession: (id) => {
      const tab = tabsRef.current.find((entry) => leafIds(entry.layout).includes(id));
      if (!tab) return false;
      active = tab.id;
      return true;
    },
    replaceBlankPaneWithSession: vi.fn(() => false),
    linkedSessionUpdatesRef: { current: new Map() },
    revealLinkedSessionUpdate: vi.fn(),
    orchestrator: {
      forSession: () => undefined,
    } as unknown as OpenSessionActionsDeps["orchestrator"],
    workspaceNavigation: {
      cancel: vi.fn(() => {
        epoch++;
      }),
      captureRequest: () => {
        const captured = epoch;
        return () => captured === epoch;
      },
    },
  };
  mocks.resolve.mockResolvedValue(nativeTarget());
  mocks.getSession.mockResolvedValue(target);
  mocks.loadRemoteBlock.mockResolvedValue({
    id: "user-turn",
    role: "user",
    text: "Cited question",
  });
  mocks.sessionAccessForMachine.mockReturnValue({});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mounted = true;
  act(() => root.render(createElement(Harness)));
});

afterEach(() => {
  if (mounted) act(() => root.unmount());
  container.remove();
  for (const session of getSessions()) {
    clearComposerDraft(session.id);
    const jump = peekTranscriptJump(session.id);
    if (jump) clearTranscriptJump(session.id, jump.token);
  }
  resetSessionsStore([]);
  vi.unstubAllGlobals();
});

async function open(ref = reference, options?: { beside?: boolean }) {
  await act(async () => {
    await navigation.open(ref, options);
  });
}

it("opens through real tab actions, focuses an existing tab, and preserves both drafts and archive metadata", async () => {
  setComposerDraft(source.id, "Source draft, selection remains owned by its composer");
  setComposerDraft(target.id, "Target draft");
  const originalSource = structuredClone(source);
  await open();
  const tab = deps.tabsRef.current.find((entry) => entry.focusedId === target.id)!;
  expect(active).toBe(tab.id);
  expect(deps.tabsRef.current).toHaveLength(2);
  await open();
  expect(deps.tabsRef.current).toHaveLength(2);
  expect(active).toBe(tab.id);
  expect(getComposerDraft(source.id)).toBe("Source draft, selection remains owned by its composer");
  expect(getComposerDraft(target.id)).toBe("Target draft");
  expect(source).toEqual(originalSource);
  expect(nativeTarget().archived).toBe(true);
  expect(mocks.loadRemoteBlock).not.toHaveBeenCalled();
});

it("self-links reuse the current tab and explicit Open beside uses the existing pane planner", async () => {
  mocks.resolve.mockResolvedValueOnce({
    ...nativeTarget(),
    locator: { ...reference.locator, sessionId: source.id },
  });
  await open();
  expect(deps.tabsRef.current).toHaveLength(1);
  await open(reference, { beside: true });
  expect(leafIds(deps.tabsRef.current.find((tab) => tab.id === active)!.layout)).toEqual([
    source.id,
    target.id,
  ]);
});

it("ignores stale rapid clicks, privacy revocation and unrelated workspace navigation", async () => {
  let resolveFirst!: (value: ResolvedLocalSession) => void;
  mocks.resolve.mockReturnValueOnce(
    new Promise<ResolvedLocalSession>((resolve) => {
      resolveFirst = resolve;
    }),
  );
  const first = navigation.open(reference);
  await open();
  resolveFirst({
    ...nativeTarget(),
    locator: { ...reference.locator, sessionId: source.id },
  });
  await act(async () => {
    await first;
  });
  expect(deps.tabsRef.current.find((tab) => tab.id === active)?.focusedId).toBe(target.id);
  mocks.resolve.mockImplementationOnce(async () => {
    mocks.privacy = { lock: {} };
    return nativeTarget();
  });
  const calls = vi.mocked(deps.ensureOpenSession).mock.calls.length;
  await open();
  expect(vi.mocked(deps.ensureOpenSession).mock.calls).toHaveLength(calls);
  mocks.privacy = { lock: {} };
  act(() => root.render(createElement(Harness)));
  mocks.resolve.mockImplementationOnce(async () => {
    epoch++;
    return nativeTarget();
  });
  await open();
  expect(vi.mocked(deps.ensureOpenSession).mock.calls).toHaveLength(calls);
});

it("abandons a pending navigation when its workspace adapter unmounts", async () => {
  let finish!: (value: ResolvedLocalSession) => void;
  mocks.resolve.mockReturnValueOnce(
    new Promise<ResolvedLocalSession>((resolve) => {
      finish = resolve;
    }),
  );
  const pending = navigation.open(reference);
  act(() => root.unmount());
  mounted = false;
  finish(nativeTarget());
  await pending;
  expect(deps.ensureOpenSession).not.toHaveBeenCalled();
  expect(showSessions).not.toHaveBeenCalled();
});

it("jumps only to a proven Native user turn and leaves missing citations recoverable", async () => {
  const turn = { ...reference, turnId: "user-turn" };
  target.blocks = [{ id: "user-turn", role: "user", text: "Question" } as never];
  await open(turn);
  expect(peekTranscriptJump(target.id)?.blockId).toBe("user-turn");
  mocks.getSession.mockResolvedValueOnce({ ...target, blocks: [] });
  await expect(open({ ...reference, turnId: "removed" })).rejects.toThrow("cited turn");
  expect(deps.tabsRef.current).toHaveLength(2);
  await open(reference);
  expect(deps.tabsRef.current).toHaveLength(2);
});

it("reuses the persisted Host shell by environment and canonical id even when it is not open", async () => {
  const shell = saveHostSessionBinding(
    {
      ...newDefaultSession("/project"),
      id: "saved-shell",
      title: "Saved shell",
    },
    {
      kind: "local-host",
      machineId: "machine",
      environmentId: "local-env",
      projectId: "project",
      sessionId: "host-target",
      authorityGeneration: null,
      created: true,
    },
  );
  mocks.resolve.mockResolvedValue(hostTarget());
  await open({ locator: hostTarget().locator, turnId: "user-turn" });
  expect(vi.mocked(deps.ensureOpenSession)).toHaveBeenCalledWith(shell.id);
  expect(deps.tabsRef.current.find((tab) => tab.id === active)?.focusedId).toBe(shell.id);
  expect(getSessions()).toHaveLength(2);
  expect(mocks.loadRemoteBlock).toHaveBeenCalledWith(
    "machine",
    "host-target",
    "user-turn",
    7,
    expect.objectContaining({ environmentId: "local-env" }),
  );
  expect(peekTranscriptJump(shell.id)?.blockId).toBe("user-turn");
});

it("creates one display-only Host shell and rejects a missing cited block before shell creation", async () => {
  mocks.resolve.mockResolvedValue(hostTarget());
  mocks.loadRemoteBlock.mockRejectedValueOnce(new Error("missing cited block"));
  await expect(open({ locator: hostTarget().locator, turnId: "removed" })).rejects.toThrow(
    "cited turn",
  );
  expect(getSessions()).toHaveLength(2);
  await open({ locator: hostTarget().locator });
  expect(getSessions()).toHaveLength(3);
  const shell = getSessions().find((session) => session.hostBinding?.sessionId === "host-target")!;
  expect(shell.blocks).toEqual([]);
  expect(shell.id).not.toBe("host-target");
  await open({ locator: hostTarget().locator });
  expect(getSessions()).toHaveLength(3);
  expect(deps.tabsRef.current).toHaveLength(2);
});

it("rejects missing, assistant, private and draft Host cited blocks before opening a shell", async () => {
  mocks.resolve.mockResolvedValue(hostTarget());
  for (const block of [
    undefined,
    { id: "user-turn", role: "assistant", text: "Response" },
    { id: "user-turn", role: "user", text: "Private", internal: true },
    { id: "user-turn", role: "user", text: "Draft", draft: true },
  ]) {
    mocks.loadRemoteBlock.mockResolvedValueOnce(block);
    await expect(open({ locator: hostTarget().locator, turnId: "user-turn" })).rejects.toThrow(
      "cited turn",
    );
  }
  expect(getSessions()).toHaveLength(2);
  expect(deps.ensureOpenSession).not.toHaveBeenCalled();
});

it("maps a canonical Host worker and lead to distinct local shells before using existing worker navigation", async () => {
  const worker = hostTarget();
  worker.host!.snapshot.session.orchestrationLeadId = "canonical-lead";
  const lead: ResolvedLocalSession = {
    ...hostTarget(),
    locator: {
      kind: "host",
      environmentId: "local-env",
      sessionId: "canonical-lead",
    },
    title: "Lead",
    host: {
      ...hostTarget().host!,
      snapshot: {
        ...hostTarget().host!.snapshot,
        session: { ...target, id: "canonical-lead", title: "Lead" },
      },
    },
  };
  mocks.resolve.mockImplementation(async (ref: LocalSessionReference) =>
    ref.locator.sessionId === "canonical-lead" ? lead : worker,
  );
  await open({ locator: worker.locator });
  const workerShell = getSessions().find(
    (session) => session.hostBinding?.sessionId === "host-target",
  )!;
  const leadShell = getSessions().find(
    (session) => session.hostBinding?.sessionId === "canonical-lead",
  )!;
  expect(workerShell.id).not.toBe("host-target");
  expect(leadShell.id).not.toBe("canonical-lead");
  expect(workerShell.orchestrationLeadId).toBe(leadShell.id);
  expect(leafIds(deps.tabsRef.current.find((tab) => tab.id === active)!.layout)).toContain(
    leadShell.id,
  );
  expect(deps.setInspectedWorkerId).toHaveBeenCalledWith(workerShell.id);
  const workerFiles = () =>
    deps.tabsRef.current.flatMap((tab) =>
      tab.editorPanes.flatMap((pane) =>
        pane.files.filter((file) => file.agent?.sessionId === workerShell.id),
      ),
    );
  expect(workerFiles()).toHaveLength(1);
  expect(deps.tabsRef.current.find((tab) => tab.id === active)?.editorPanes[0].activeFileId).toBe(
    workerFiles()[0].id,
  );
  expect(mocks.resolve).toHaveBeenCalledWith({
    locator: {
      kind: "host",
      environmentId: "local-env",
      sessionId: "canonical-lead",
    },
  });
  await open({ locator: worker.locator });
  expect(getSessions()).toHaveLength(4);
  expect(deps.tabsRef.current).toHaveLength(2);
  expect(workerFiles()).toHaveLength(1);
});

it("opens the Native worker's read-only editor and preserves the cited jump until its transcript mounts", async () => {
  target.orchestrationLeadId = source.id;
  target.blocks = [{ id: "user-turn", role: "user", text: "Question" } as never];
  await open({ ...reference, turnId: "user-turn" });
  expect(deps.tabsRef.current).toHaveLength(1);
  const files = deps.tabsRef.current[0].editorPanes.flatMap((pane) => pane.files);
  expect(files).toHaveLength(1);
  expect(files[0].agent).toMatchObject({ sessionId: target.id, leadId: source.id });
  expect(peekTranscriptJump(target.id)?.blockId).toBe("user-turn");
  await open({ ...reference, turnId: "user-turn" });
  expect(deps.tabsRef.current).toHaveLength(1);
  expect(deps.tabsRef.current[0].editorPanes.flatMap((pane) => pane.files)).toHaveLength(1);
  await open({ ...reference, turnId: "user-turn" }, { beside: true });
  expect(deps.tabsRef.current).toHaveLength(1);
  expect(leafIds(deps.tabsRef.current[0].layout)).not.toContain(target.id);
  expect(deps.tabsRef.current[0].editorPanes.flatMap((pane) => pane.files)).toHaveLength(1);
});

it.each([false, true])(
  "rechecks reference privacy during delegated tab loading (beside=%s)",
  async (beside) => {
    vi.mocked(deps.ensureOpenSession)
      .mockResolvedValueOnce(target)
      .mockImplementation(async (id) => {
        mocks.privacy = { lock: {} };
        return getSessions().find((entry) => entry.id === id) ?? null;
      });
    await open(reference, { beside });
    expect(deps.tabsRef.current).toHaveLength(1);
    expect(deps.tabsRef.current[0].editorPanes).toEqual([]);
    expect(active).toBe(deps.tabsRef.current[0].id);
  },
);

it("does not publish worker panes or a jump after the target is locked during worker loading", async () => {
  target.orchestrationLeadId = source.id;
  target.blocks = [{ id: "user-turn", role: "user", text: "Question" } as never];
  const originalEnsure = deps.ensureOpenSession;
  vi.mocked(deps.ensureOpenSession).mockImplementation(async (id) => {
    if (id === source.id) mocks.locked = true;
    return getSessions().find((entry) => entry.id === id) ?? null;
  });
  await expect(open({ ...reference, turnId: "user-turn" })).rejects.toThrow("unavailable");
  expect(deps.tabsRef.current[0].editorPanes).toEqual([]);
  expect(peekTranscriptJump(target.id)).toBeNull();
  deps.ensureOpenSession = originalEnsure;
});

it("refreshes only Host shell archive presentation from the verified owner when reusing a shell", async () => {
  mocks.resolve.mockResolvedValue(hostTarget());
  await open({ locator: hostTarget().locator });
  expect(hostSessionShellSummaries().find((entry) => entry.title === "Host target")?.archived).toBe(
    true,
  );
  const unarchived = hostTarget();
  unarchived.archived = false;
  mocks.resolve.mockResolvedValue(unarchived);
  await open({ locator: unarchived.locator });
  expect(hostSessionShellSummaries().find((entry) => entry.title === "Host target")?.archived).toBe(
    false,
  );
  expect(mocks.loadRemoteBlock).not.toHaveBeenCalled();
  expect(deps.tabsRef.current).toHaveLength(2);
});

it("rejects cyclic Host lead relationships before saving shells or opening tabs", async () => {
  const worker = hostTarget();
  worker.host!.snapshot.session.orchestrationLeadId = "canonical-lead";
  const lead: ResolvedLocalSession = {
    ...hostTarget(),
    locator: {
      kind: "host",
      environmentId: "local-env",
      sessionId: "canonical-lead",
    },
    host: {
      ...hostTarget().host!,
      snapshot: {
        ...hostTarget().host!.snapshot,
        session: {
          ...target,
          id: "canonical-lead",
          orchestrationLeadId: "host-target",
        },
      },
    },
  };
  mocks.resolve.mockImplementation(async (ref: LocalSessionReference) =>
    ref.locator.sessionId === "canonical-lead" ? lead : worker,
  );
  await expect(open({ locator: worker.locator })).rejects.toThrow("unavailable");
  expect(getSessions()).toHaveLength(2);
  expect(deps.tabsRef.current).toHaveLength(1);
  expect(deps.ensureOpenSession).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
});

it("clears an obsolete Host lead mapping before the existing tab opener runs", async () => {
  const shell = saveHostSessionBinding(
    { ...newDefaultSession("/project"), id: "old-worker-shell", orchestrationLeadId: target.id },
    {
      kind: "local-host",
      machineId: "machine",
      environmentId: "local-env",
      projectId: "project",
      sessionId: "host-target",
      authorityGeneration: null,
      created: true,
    },
  );
  mocks.resolve.mockResolvedValue(hostTarget());
  await open({ locator: hostTarget().locator });
  expect(restoreHostSessionShell(shell.id)?.orchestrationLeadId).toBeUndefined();
  expect(getSessions().find((entry) => entry.id === shell.id)?.orchestrationLeadId).toBeUndefined();
  expect(deps.tabsRef.current.find((tab) => tab.id === active)?.focusedId).toBe(shell.id);
  expect(deps.setInspectedWorkerId).not.toHaveBeenCalled();
});

it("never focuses a same-id Host shell for a verified Native reference", async () => {
  saveHostSessionBinding(
    { ...newDefaultSession("/project"), id: target.id },
    {
      kind: "local-host",
      machineId: "machine",
      environmentId: "other-origin",
      projectId: "project",
      sessionId: "different-host-conversation",
      authorityGeneration: null,
      created: true,
    },
  );
  await expect(open(reference)).rejects.toThrow("unavailable");
  expect(deps.ensureOpenSession).not.toHaveBeenCalled();
  expect(showSessions).not.toHaveBeenCalled();
  expect(deps.tabsRef.current).toHaveLength(1);
});

it("does not post a pending turn jump after delegated tab opening loses navigation ownership", async () => {
  target.blocks = [{ id: "user-turn", role: "user", text: "Question" } as never];
  let finish!: (value: Session) => void;
  vi.mocked(deps.ensureOpenSession)
    .mockResolvedValueOnce(target)
    .mockImplementationOnce(
      () =>
        new Promise<Session>((resolve) => {
          finish = resolve;
        }),
    );
  const pending = navigation.open({ ...reference, turnId: "user-turn" });
  await act(async () => {
    await Promise.resolve();
  });
  expect(deps.ensureOpenSession).toHaveBeenCalledTimes(2);
  epoch++;
  finish(target);
  await act(async () => {
    await pending;
  });
  expect(peekTranscriptJump(target.id)).toBeNull();
  expect(deps.tabsRef.current).toHaveLength(1);
  expect(deps.tabsRef.current.find((tab) => tab.id === active)?.focusedId).toBe(source.id);
});
