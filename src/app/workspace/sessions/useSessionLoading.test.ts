// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { newSession } from "../../../features/sessions/model/session";
import { useSessionLoading, type SessionLoadingDeps } from "./useSessionLoading";

const mocks = vi.hoisted(() => ({ reserve: vi.fn(), get: vi.fn() }));
vi.mock("../../model/sessionWindowOwnership", () => ({
  reserveSessionWindow: mocks.reserve,
  remoteSessionOwnershipKey: (cwd: string, id: string) => `${cwd}:${id}`,
}));
vi.mock("../../../features/sessions/data/sessionStore", () => ({
  getSession: mocks.get,
  persistFingerprint: () => "fingerprint",
}));

it("does not create a pop-out pane when ownership is foreign or becomes stale", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const session = newSession("codex", "/repo");
  const refs = { current: [] as (typeof session)[] };
  const removing = { current: new Set<string>() };
  const tabsRef = { current: [] } as SessionLoadingDeps["tabsRef"];
  const popout = vi.fn();
  const deps: SessionLoadingDeps = {
    sessionsRef: refs,
    setSessions: vi.fn(),
    setTabs: vi.fn(),
    tabsRef,
    onPopOutPane: popout,
    lastPersisted: { current: new Map() },
    loadedSessionCache: { current: new Map() },
    sessionLoads: { current: new Map() },
    sessionLoadEpochs: { current: new Map() },
    openingSessionIds: { current: new Set() },
    removingSessionIds: removing,
    activeSessionPrefetch: { current: null },
    sidebarCwd: "/repo",
    refreshHistory: async () => {},
  };
  let actions!: ReturnType<typeof useSessionLoading>;
  function Harness() {
    actions = useSessionLoading(deps);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Harness)));
    mocks.get.mockResolvedValue(session);
    mocks.reserve.mockResolvedValueOnce(null);
    await act(async () => actions.onPopOutSession(session.id, { x: 0, y: 0 }));
    expect(mocks.get).toHaveBeenCalledOnce();
    const release = vi.fn(async () => {});
    mocks.reserve.mockImplementationOnce(async () => {
      removing.current.add(session.id);
      return release;
    });
    await act(async () => actions.onPopOutSession(session.id, { x: 0, y: 0 }));
    expect(release).toHaveBeenCalledWith(false);
    expect(tabsRef.current).toHaveLength(0);
    expect(popout).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

function retryHarness(initial: ReturnType<typeof newSession>) {
  const refs = { current: [initial] };
  const deps: SessionLoadingDeps = {
    sessionsRef: refs,
    setSessions: vi.fn((update) => {
      refs.current = typeof update === "function" ? update(refs.current) : update;
    }) as SessionLoadingDeps["setSessions"],
    setTabs: vi.fn(),
    tabsRef: { current: [] },
    onPopOutPane: vi.fn(),
    lastPersisted: { current: new Map() },
    loadedSessionCache: { current: new Map() },
    sessionLoads: { current: new Map() },
    sessionLoadEpochs: { current: new Map() },
    openingSessionIds: { current: new Set() },
    removingSessionIds: { current: new Set() },
    activeSessionPrefetch: { current: null },
    sidebarCwd: "/repo",
    refreshHistory: async () => {},
  };
  let actions!: ReturnType<typeof useSessionLoading>;
  function Harness() {
    actions = useSessionLoading(deps);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  return {
    refs,
    mount: () => act(async () => root.render(createElement(Harness))),
    retry: (id: string) => act(async () => actions.onRetrySessionHistory(id)),
    unmount: () => act(async () => root.unmount()),
  };
}

const failedTail = () => ({
  ...newSession("codex", "/repo"),
  blocks: [{ id: "tail", role: "user" as const, text: "Latest" }],
  historyLoading: true,
  historyLoadError: "Earlier messages could not be loaded. Reopen this chat to retry.",
});

it("retries a failed history read in place and keeps the loaded turns until the pages arrive", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const failed = failedTail();
  const view = retryHarness(failed);
  try {
    await view.mount();
    mocks.get.mockImplementationOnce(async (_id, options) => {
      // A fresh tail read: same content, new identity.
      const tail = { ...failed, blocks: [...failed.blocks], historyLoadError: undefined };
      expect(view.refs.current[0].historyLoadError).toBeUndefined();
      expect(view.refs.current[0].blocks).toBe(failed.blocks);
      const older = { id: "old", role: "user" as const, text: "Earlier" };
      options.onHydrated(tail, { ...tail, blocks: [older, ...tail.blocks], historyLoading: false });
      return tail;
    });
    await view.retry(failed.id);
    expect(view.refs.current[0].historyLoading).toBe(false);
    expect(view.refs.current[0].historyLoadError).toBeUndefined();
    expect(view.refs.current[0].blocks.map((block) => block.id)).toEqual(["old", "tail"]);
  } finally {
    await view.unmount();
    vi.unstubAllGlobals();
  }
});

it("shows the failure again, with the same turns, when the retry fails too", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const failed = failedTail();
  const view = retryHarness(failed);
  try {
    await view.mount();
    mocks.get.mockRejectedValueOnce(new Error("offline"));
    await view.retry(failed.id);
    expect(view.refs.current[0].historyLoadError).toBeTruthy();
    expect(view.refs.current[0].blocks).toBe(failed.blocks);
    expect(view.refs.current[0].historyLoading).toBe(true);
  } finally {
    await view.unmount();
    vi.unstubAllGlobals();
  }
});

it("ignores a retry for a conversation that has not failed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const loading = { ...failedTail(), historyLoadError: undefined };
  mocks.get.mockClear();
  const view = retryHarness(loading);
  try {
    await view.mount();
    await view.retry(loading.id);
    expect(mocks.get).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
    vi.unstubAllGlobals();
  }
});
