// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { newSession } from "../../../features/sessions/model/session";
import { useSessionComposerDraft } from "../../../features/sessions/ui/useSessionComposerDraft";
import { useSessionLoading, type SessionLoadingDeps } from "./useSessionLoading";

const mocks = vi.hoisted(() => ({ reserve: vi.fn(), get: vi.fn(), page: vi.fn() }));
vi.mock("../../model/sessionWindowOwnership", () => ({
  reserveSessionWindow: mocks.reserve,
  remoteSessionOwnershipKey: (cwd: string, id: string) => `${cwd}:${id}`,
}));
vi.mock("../../../features/sessions/data/sessionStore", () => ({
  getSession: mocks.get,
  getEarlierStoredHistory: mocks.page,
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
  let draft!: ReturnType<typeof useSessionComposerDraft>;
  function Harness() {
    actions = useSessionLoading(deps);
    draft = useSessionComposerDraft(
      initial.id,
      initial.storedHistory?.revision,
      actions.ensureSessionHistoryForExecution,
    );
    return null;
  }
  const root = createRoot(document.createElement("div"));
  return {
    refs,
    publications: deps.setSessions,
    loadHistory: (signal: AbortSignal) => actions.onLoadSessionHistory(initial.id, signal),
    mount: () => act(async () => root.render(createElement(Harness))),
    retry: (id: string) => act(async () => actions.onRetrySessionHistory(id)),
    edit: (text: string) => act(async () => draft.change(text)),
    prepareSend: () => actions.ensureSessionHistoryForExecution(initial.id),
    unmount: () => act(async () => root.unmount()),
  };
}

it.each([false, true])(
  "reads all Find pages without intermediate publication or execution hydration; abort %s",
  async (abort) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const session = {
      ...newSession("codex", "/repo"),
      storedHistory: { before: 400, revision: 2 },
      historyLoading: true,
    };
    const h = retryHarness(session);
    const controller = new AbortController();
    const block = (id: string) => ({ id, role: "user", text: id });
    mocks.page
      .mockReset()
      .mockImplementationOnce(() => {
        if (abort) controller.abort();
        return { blocks: [block("middle")], cursor: { revision: 2, before: 200 } };
      })
      .mockResolvedValueOnce({ blocks: [block("first")], cursor: { revision: 2 } });
    mocks.get.mockClear();
    try {
      await h.mount();
      expect(await h.loadHistory(controller.signal)).toBe(abort ? 0 : 2);
      expect(mocks.page).toHaveBeenCalledTimes(abort ? 1 : 2);
      expect(h.publications).toHaveBeenCalledTimes(abort ? 0 : 1);
      expect(h.refs.current[0].blocks.map((b) => b.id)).toEqual(abort ? [] : ["first", "middle"]);
      expect(h.refs.current[0].historyLoading).toBe(true);
      expect(mocks.get).not.toHaveBeenCalled();
    } finally {
      await h.unmount();
      vi.unstubAllGlobals();
    }
  },
);

const failedTail = () => ({
  ...newSession("codex", "/repo"),
  blocks: [{ id: "tail", role: "user" as const, text: "Latest" }],
  historyLoading: true,
  historyLoadError: "Earlier messages could not be loaded. Reopen this chat to retry.",
});

it.each([true, false])(
  "reads on edit, publishes only on send, and reuses the read (immediate: %s)",
  async (immediate) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const tail = {
      ...failedTail(),
      historyLoadError: undefined,
      storedHistory: { before: 27, revision: 1 },
    };
    const complete = {
      ...tail,
      historyLoading: false,
      storedHistory: undefined,
      blocks: [{ id: "old", role: "assistant" as const, text: "Earlier" }, ...tail.blocks],
    };
    const read = Promise.withResolvers<typeof complete>();
    mocks.get.mockReset().mockReturnValueOnce(read.promise);
    const view = retryHarness(tail);
    try {
      await view.mount();
      expect(mocks.get).not.toHaveBeenCalled();
      await view.edit("reply");
      expect(mocks.get).toHaveBeenCalledExactlyOnceWith(tail.id);
      const waitingSend = immediate ? view.prepareSend() : undefined;
      expect(view.refs.current[0].blocks).toBe(tail.blocks);
      read.resolve(complete);
      await act(async () => {});
      if (!immediate) expect(view.refs.current[0].blocks).toBe(tail.blocks);
      await expect(waitingSend ?? view.prepareSend()).resolves.toBe(true);
      expect(view.refs.current[0].blocks).toEqual(complete.blocks);
      await expect(view.prepareSend()).resolves.toBe(true);
      expect(mocks.get).toHaveBeenCalledTimes(1);
    } finally {
      await view.unmount();
      vi.unstubAllGlobals();
    }
  },
);

it.each(["read failed", "tail replaced"])(
  "reads again on send when the draft warm-up cannot be used: %s",
  async (reason) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const tail = {
      ...failedTail(),
      historyLoadError: undefined,
      storedHistory: { before: 27, revision: 1 },
    };
    const complete = { ...tail, historyLoading: false, storedHistory: undefined };
    mocks.get.mockReset();
    if (reason === "read failed") mocks.get.mockRejectedValueOnce(new Error("offline"));
    else mocks.get.mockResolvedValueOnce(complete);
    mocks.get.mockResolvedValueOnce(complete);
    const view = retryHarness(tail);
    try {
      await view.mount();
      await view.edit("reply");
      if (reason === "tail replaced") view.refs.current = [{ ...tail, blocks: [...tail.blocks] }];
      expect(view.refs.current[0].historyLoading).toBe(true);
      await expect(view.prepareSend()).resolves.toBe(true);
      expect(mocks.get).toHaveBeenCalledTimes(2);
    } finally {
      await view.unmount();
      vi.unstubAllGlobals();
    }
  },
);

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
