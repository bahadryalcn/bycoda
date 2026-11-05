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
