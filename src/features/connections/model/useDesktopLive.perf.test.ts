// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
import { DESKTOP_LIVE_CAPABILITY, DESKTOP_LIVE_MS, type DesktopLiveHandlers } from "./desktopLive";
import { adoptedBeatFresh, setAdoptedWaker } from "./hostWake";
import { useDesktopLive } from "./useDesktopLive";
import { flushDesktopLive } from "./desktopLiveFlush";

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
  hostReachable.current = true;
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
  setAdoptedWaker(undefined);
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

  // Step 8: the adopted-session mirror runs on the heartbeat's answer, not on its own timer.
  it("wakes the adopted-session mirror only when the host reports a change", async () => {
    const wake = vi.fn();
    setAdoptedWaker(wake);
    let seq = 0;
    mocks.request.mockImplementation(async (_machine: string, _method: string, payload: any) => {
      // The host moves one adopted session on its third answer.
      const moved = payload.adoptedSeq !== undefined && ++seq === 3;
      return {
        adopted: {
          seq: moved ? 1 : 0,
          ids: moved ? ["a"] : [],
          reset: payload.adoptedSeq === undefined,
        },
      };
    });
    // Busy, so that every tick reaches the host.
    sessionsRef.current = [{ id: "a", cwd: "/repo", blocks: [], busy: true } as unknown as Session];
    await act(async () => {
      root.render(createElement(Probe));
    });
    await advance(DESKTOP_LIVE_MS * 6);
    expect(mocks.request.mock.calls.length).toBeGreaterThanOrEqual(5);
    // The first answer (a reset) and the one change: nothing else wakes it.
    expect(wake.mock.calls).toEqual([[undefined], [["a"]]]);
    expect(adoptedBeatFresh()).toBe(true);
  });

  it("holds one timer while idle", async () => {
    await act(async () => {
      root.render(createElement(Probe));
    });
    await advance(DESKTOP_LIVE_MS * 4);
    expect(vi.getTimerCount()).toBe(1);
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

it("flushes current idle state only after an older busy publication is acknowledged", async () => {
  let acknowledgeBusy!: (value: object) => void;
  mocks.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        acknowledgeBusy = resolve;
      }),
  );
  sessionsRef.current = [{ ...sessionsRef.current[0], busy: true }];
  await act(async () => root.render(createElement(Probe)));
  expect(mocks.request).toHaveBeenCalledOnce();
  sessionsRef.current = [{ ...sessionsRef.current[0], busy: false }];
  const flushed = flushDesktopLive();
  await Promise.resolve();
  expect(mocks.request).toHaveBeenCalledOnce();
  acknowledgeBusy({});
  await flushed;
  expect(mocks.request).toHaveBeenCalledTimes(2);
  expect(mocks.request.mock.calls[0][2].sessions).toEqual([
    expect.objectContaining({ id: "a", busy: true }),
  ]);
  expect(mocks.request.mock.calls[1][2].sessions).toEqual([]);
});

it("forces an acknowledged idle flush inside the normal idle throttle window", async () => {
  await act(async () => root.render(createElement(Probe)));
  const before = mocks.request.mock.calls.length;
  await flushDesktopLive();
  expect(mocks.request.mock.calls.length).toBe(before + 1);
});

it("preserves actual busy state and propagates Host failure from an explicit flush", async () => {
  await act(async () => root.render(createElement(Probe)));
  sessionsRef.current = [{ ...sessionsRef.current[0], busy: true }];
  await flushDesktopLive();
  expect(mocks.request.mock.calls.at(-1)?.[2].sessions).toEqual([
    expect.objectContaining({ id: "a", busy: true }),
  ]);
  mocks.request.mockRejectedValueOnce(new Error("Host unavailable"));
  await expect(flushDesktopLive()).rejects.toThrow("Host unavailable");
  hostReachable.current = false;
  await expect(flushDesktopLive()).rejects.toThrow("unreachable");
});
