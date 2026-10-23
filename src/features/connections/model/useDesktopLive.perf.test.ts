// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
import { DESKTOP_LIVE_CAPABILITY, DESKTOP_LIVE_MS, type DesktopLiveHandlers } from "./desktopLive";
import { useDesktopLive } from "./useDesktopLive";

const mocks = vi.hoisted(() => ({ request: vi.fn(), build: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async () => [
    { id: "local", environmentId: "host", localHost: true, endpoint: "http://127.0.0.1:1" },
  ],
}));
vi.mock("./connections", () => ({
  loadRemoteCapabilities: async () => [DESKTOP_LIVE_CAPABILITY],
  remoteRequest: (...args: unknown[]) => mocks.request(...args),
}));
vi.mock("../../projects/model/mobileProjectDirectory", () => ({
  buildMobileProjectDirectory: (...args: unknown[]) => mocks.build(...args),
}));
vi.mock("../../projects/model/mobileProjectLogos", () => ({
  withMobileProjectLogos: (directory: unknown) => directory,
}));

let root: Root;
let sessionsRef: { current: Session[] };
const hostReachable = { current: true };
const handlersRef = {
  current: {
    stop: () => {},
    approve: () => {},
    answer: () => {},
  } as DesktopLiveHandlers,
};
function Probe() {
  useDesktopLive(sessionsRef, handlersRef, hostReachable);
  return null;
}
async function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += DESKTOP_LIVE_MS) {
    await act(async () => {
      vi.advanceTimersByTime(DESKTOP_LIVE_MS);
      for (let i = 0; i < 40; i++) await Promise.resolve();
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.request.mockReset();
  mocks.request.mockResolvedValue({});
  mocks.build.mockReset();
  mocks.build.mockReturnValue({
    version: 1,
    projects: [],
    groups: [],
    excludedPaths: [],
    excludedGroupIds: [],
  });
  // Idle desktop: finished chats only, nothing busy or pending.
  sessionsRef = {
    current: [{ id: "a", cwd: "/repo", blocks: [] } as unknown as Session],
  };
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("desktop live heartbeat while nothing changes", () => {
  // perf P3: the builder returns the same object while its inputs are unchanged
  // (mobileProjectDirectory.perf.test.ts); the heartbeat must not re-serialize it.
  it("does not re-serialize an unchanged project directory on every tick", async () => {
    const stringify = vi.spyOn(JSON, "stringify");
    await act(async () => {
      root.render(createElement(Probe));
    });
    await advance(DESKTOP_LIVE_MS * 20);
    const directory = mocks.build.mock.results[0]?.value;
    expect(directory).toBeDefined();
    const serialized = stringify.mock.calls.filter(([value]) => value === directory);
    expect(serialized.length).toBeLessThanOrEqual(1);
    stringify.mockRestore();
  });

  it("does not repeat an unchanged empty heartbeat within the idle window", async () => {
    await act(async () => {
      root.render(createElement(Probe));
    });
    await advance(DESKTOP_LIVE_MS);
    const settled = mocks.request.mock.calls.length;
    expect(settled).toBeGreaterThanOrEqual(1);
    // Two more ticks stay inside the host's idle-heartbeat window.
    await advance(DESKTOP_LIVE_MS * 2);
    expect(mocks.request.mock.calls.length).toBe(settled);
  });

  it("reports a session that starts running within one tick", async () => {
    await act(async () => {
      root.render(createElement(Probe));
    });
    await advance(DESKTOP_LIVE_MS * 2);
    const before = mocks.request.mock.calls.length;
    sessionsRef.current = [{ id: "a", cwd: "/repo", blocks: [], busy: true } as unknown as Session];
    await advance(DESKTOP_LIVE_MS);
    expect(mocks.request.mock.calls.length).toBeGreaterThan(before);
    const payload = mocks.request.mock.calls.at(-1)?.[2] as { sessions: { id: string }[] };
    expect(payload.sessions.map((row) => row.id)).toEqual(["a"]);
  });
});
