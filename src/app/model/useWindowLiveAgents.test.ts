// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { LiveAgent } from "../../features/sessions/model/liveAgents";

const api = vi.hoisted(() => ({
  emit: vi.fn(),
  getAllWindows: vi.fn(),
  callbacks: new Map<string, (event: { payload: unknown }) => void>(),
  releases: [] as Array<ReturnType<typeof vi.fn>>,
  deferred: [] as Array<() => void>,
  delayed: false,
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: api.emit,
  emitTo: vi.fn(),
  listen: vi.fn((name: string, callback: (event: { payload: unknown }) => void) => {
    api.callbacks.set(name, callback);
    const release = vi.fn();
    api.releases.push(release);
    return api.delayed
      ? new Promise<() => void>((resolve) => api.deferred.push(() => resolve(release)))
      : Promise.resolve(release);
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getAllWindows: api.getAllWindows,
  getCurrentWindow: () => ({ label: "main" }),
}));
import { useWindowLiveAgents } from "./useWindowLiveAgents";

const agent = (id: string): LiveAgent => ({
  id,
  cwd: "/project",
  title: id,
  harness: "claude",
  activity: "Working",
  needsApproval: false,
  done: false,
});
let output: LiveAgent[];
function Probe() {
  output = useWindowLiveAgents([agent("local")], { local: "local" });
  return null;
}
let root: Root;
let container: HTMLElement;

describe("window working registry lifecycle", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.clearAllMocks();
    api.callbacks.clear();
    api.releases.length = 0;
    api.deferred.length = 0;
    api.delayed = false;
    api.emit.mockResolvedValue(undefined);
    api.getAllWindows.mockResolvedValue([{ label: "main" }]);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("keeps the Working list stable across equivalent streamed-session renders", async () => {
    await act(async () => root.render(createElement(Probe)));
    const first = output;
    api.emit.mockClear();
    await act(async () => root.render(createElement(Probe)));
    expect(output).toBe(first);
    expect(api.emit).not.toHaveBeenCalled();
  });

  it("requests existing owners after subscriptions mount and prunes closed native windows", async () => {
    await act(async () => root.render(createElement(Probe)));
    expect(api.emit).toHaveBeenCalledWith("workspace_live_agents_request");
    await act(async () =>
      api.callbacks.get("workspace_live_agents")!({
        payload: {
          ownerWindowLabel: "window-2",
          agents: [agent("other")],
          ownedSessionKeys: { other: "other" },
        },
      }),
    );
    expect(output.map((entry) => entry.id)).toEqual(["local", "other"]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(output.map((entry) => entry.id)).toEqual(["local"]);
  });

  it("releases late listener registrations when unmounted before Tauri resolves", async () => {
    api.delayed = true;
    await act(async () => root.render(createElement(Probe)));
    await act(async () => root.unmount());
    await act(async () => {
      api.deferred.forEach((resolve) => resolve());
    });
    expect(api.releases).toHaveLength(2);
    api.releases.forEach((release) => expect(release).toHaveBeenCalledOnce());
    expect(api.emit).not.toHaveBeenCalledWith("workspace_live_agents_request");
    // Recreate the root so the common cleanup remains valid.
    root = createRoot(container);
  });
  it("publishes one initial summary and only a 30-second heartbeat when unchanged", async () => {
    await act(async () => root.render(createElement(Probe)));
    const snapshots = () =>
      api.emit.mock.calls.filter(([name]) => name === "workspace_live_agents");
    expect(snapshots()).toHaveLength(1);
    const initial = snapshots()[0][1];
    await act(async () => vi.advanceTimersByTimeAsync(29_999));
    expect(snapshots()).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(snapshots()).toHaveLength(2);
    expect(snapshots()[1][1].revision).toBe(initial.revision);
    expect(snapshots()[1][1].sessionsRevision).toBeTypeOf("number");
  });

  it("ignores duplicate and older summaries from the same renderer", async () => {
    await act(async () => root.render(createElement(Probe)));
    const receive = api.callbacks.get("workspace_live_agents")!;
    const payload = {
      ownerWindowLabel: "window-2",
      sourceId: "renderer-2",
      revision: 2,
      agents: [agent("other")],
    };
    await act(async () => receive({ payload }));
    const first = output;
    await act(async () => receive({ payload: { ...payload, agents: [agent("other")] } }));
    expect(output).toBe(first);
    await act(async () => receive({ payload: { ...payload, revision: 1, agents: [] } }));
    expect(output).toBe(first);
    await act(async () =>
      receive({ payload: { ...payload, revision: 0, sourceId: "reloaded-renderer", agents: [] } }),
    );
    expect(output.map((item) => item.id)).toEqual(["local"]);
  });
});
