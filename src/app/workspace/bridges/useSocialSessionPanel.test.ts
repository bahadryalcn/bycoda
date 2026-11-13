// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Session } from "../../../features/sessions/model/session";
const state = vi.hoisted(() => ({ sessions: [] as Session[], persist: vi.fn(), load: vi.fn() }));
vi.mock("../../../features/sessions/data/sessionStore", () => ({
  createRoomSession: state.persist,
  getSession: state.load,
  isSessionDeleted: () => false,
}));
vi.mock("../../../features/sessions/model/session", () => ({
  newDefaultSession: (cwd: string) => ({
    id: "created-social-session",
    cwd,
    harness: "codex",
    model: "gpt-6.1-sol",
    blocks: [],
  }),
}));
vi.mock("../../../features/sessions/model/sessionsStore", () => ({
  getSessions: () => state.sessions,
  setSessions: (update: (sessions: Session[]) => Session[]) => {
    state.sessions = update(state.sessions);
  },
}));
import { useSocialSessionPanel } from "./useSocialSessionPanel";

it("keeps the newest workspace target when an older registration releases the same DOM host", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  let panel!: ReturnType<typeof useSocialSessionPanel>;
  function Probe() {
    panel = useSocialSessionPanel();
    return null;
  }
  try {
    await act(async () => root.render(createElement(Probe)));
    const first = { sessionId: "social", host: node, visible: true, focused: true, inSplit: false };
    const latest = { ...first, visible: false, focused: false };
    let releaseFirst!: () => void;
    let releaseLatest!: () => void;
    await act(async () => {
      releaseFirst = panel.registerTarget(first);
    });
    await act(async () => {
      releaseLatest = panel.registerTarget(latest);
    });
    await act(async () => releaseFirst());
    expect(panel.workspaceTargets.social).toBe(latest);
    await act(async () => releaseLatest());
    expect(panel.workspaceTargets.social).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    node.remove();
    vi.unstubAllGlobals();
  }
});

it("recovers an unbound remote shell from its scoped ID when no workspace tab was restored", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.persist.mockReset();
  state.load.mockReset().mockResolvedValue(null);
  state.sessions = [];
  const scope = { key: "test:remote-no-tabs", cwd: "remote://host/project", title: "Social Media" };
  localStorage.setItem(`bycoda.session-panel.v1:${scope.key}`, "unbound-remote");
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  let panel!: ReturnType<typeof useSocialSessionPanel>;
  function Probe() {
    panel = useSocialSessionPanel();
    return null;
  }
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => {
      expect(await panel.open(scope)).toBe("unbound-remote");
    });
    expect(state.load).toHaveBeenCalledWith("unbound-remote");
    expect(state.persist).not.toHaveBeenCalled();
    expect(state.sessions[0]).toMatchObject({ id: "unbound-remote", cwd: scope.cwd });
    expect(state.sessions[0]?.pendingContextReplay).toContain("bycoda-social");
  } finally {
    await act(async () => root.unmount());
    node.remove();
    vi.unstubAllGlobals();
  }
});

it("reopens a restored empty remote shell without creating a local Host session", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.persist.mockReset();
  const scope = {
    key: "test:restored-remote-social",
    cwd: "remote://host/project",
    title: "Social Media",
  };
  localStorage.setItem(`bycoda.session-panel.v1:${scope.key}`, "restored-remote");
  state.sessions = [{ id: "restored-remote", cwd: scope.cwd, blocks: [] } as unknown as Session];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let panel!: ReturnType<typeof useSocialSessionPanel>;
  function Probe() {
    panel = useSocialSessionPanel();
    return null;
  }
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => {
      expect(await panel.open(scope)).toBe("restored-remote");
    });
    expect(state.persist).not.toHaveBeenCalled();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]?.pendingContextReplay).toContain("bycoda-social");
    expect(panel.sessionIds).toEqual(["restored-remote"]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("durably creates one real local session and reuses it on reopen", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  state.sessions = [];
  state.persist.mockReset().mockResolvedValue({ id: "created-social-session" });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let panel!: ReturnType<typeof useSocialSessionPanel>;
  function Probe() {
    panel = useSocialSessionPanel();
    return null;
  }
  const scope = { key: "test:local-social", cwd: "/project", title: "Social Media" };
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => {
      await panel.open(scope);
    });
    expect(state.persist).toHaveBeenCalledTimes(1);
    expect(state.persist.mock.calls[0]?.[0].pendingContextReplay).toBeUndefined();
    expect(state.sessions[0]).toMatchObject({
      cwd: "/project",
      title: "Social Media",
      harness: "codex",
    });
    expect(state.sessions[0]?.pendingContextReplay).toContain("bycoda-social");
    await act(async () => {
      await panel.open(scope);
    });
    expect(state.persist).toHaveBeenCalledTimes(1);
    expect(panel.sessionIds).toEqual(["created-social-session"]);
    expect(state.sessions).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
