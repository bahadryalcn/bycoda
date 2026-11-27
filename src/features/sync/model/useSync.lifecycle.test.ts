// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  nudge: vi.fn(),
  recover: vi.fn(),
  stop: vi.fn(),
  capabilities: vi.fn(async () => ["sync"]),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, isTauri: () => false }));
vi.mock("../../connections/model/connections", () => ({
  cachedRemoteCapabilities: () => ["sync"],
  loadRemoteCapabilities: mocks.capabilities,
  remoteRequest: vi.fn(),
}));
vi.mock("./syncClient", async (original) => ({
  ...(await original<typeof import("./syncClient")>()),
  startSyncLoop: () => ({ nudge: mocks.nudge, recover: mocks.recover, stop: mocks.stop }),
}));

import { CYCLE_INTERVAL_MS } from "./syncClient";
import { startAppSync } from "./useSync";
import { notifyRemoteRecovered, resetRemoteHealth } from "../../connections/model/remoteHealth";

const machines = [
  { id: "pc", name: "PC", environmentId: "pc-env", endpoint: "" },
  { id: "offline", name: "Offline", environmentId: "offline-env", endpoint: "" },
];
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  resetRemoteHealth();
  mocks.stop.mockResolvedValue(true);
  mocks.invoke.mockImplementation(async (command) =>
    command === "remote_machines" ? machines : machines[0],
  );
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.clearAllMocks();
});
const flush = () => vi.advanceTimersByTimeAsync(0);

it("refreshes and releases sync backoff for a verified recovered peer only", async () => {
  stop = startAppSync();
  await flush();
  mocks.nudge.mockClear();
  notifyRemoteRecovered("pc-env");
  await flush();
  expect(mocks.recover).toHaveBeenCalledExactlyOnceWith("pc");
  stop();
  stop = undefined;
  mocks.invoke.mockClear();
  notifyRemoteRecovered("pc-env");
  window.dispatchEvent(new Event("online"));
  window.dispatchEvent(new Event("focus"));
  document.dispatchEvent(new Event("visibilitychange"));
  await flush();
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("coalesces overlapping wake discoveries and nudges newly discovered machines", async () => {
  stop = startAppSync();
  await flush();
  mocks.invoke.mockClear();
  mocks.nudge.mockClear();
  let finish!: (value: unknown) => void;
  mocks.invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new Event("online"));
  document.dispatchEvent(new Event("visibilitychange"));
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("remote_machines");
  finish(machines);
  await flush();
  expect(mocks.nudge).toHaveBeenCalled();
});

it("pauses the 30 s machine refresh while hidden and catches up when the window returns", async () => {
  let hidden = true;
  const hiddenSpy = vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  try {
    stop = startAppSync();
    await flush();
    mocks.invoke.mockClear();
    mocks.nudge.mockClear();

    await vi.advanceTimersByTimeAsync(CYCLE_INTERVAL_MS * 3);
    expect(mocks.invoke).not.toHaveBeenCalled();

    // Visible again: the loop catches up itself while inventory refreshes in parallel.
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(mocks.invoke).toHaveBeenCalledWith("remote_machines");
    expect(mocks.nudge).not.toHaveBeenCalled();

    // The periodic refresh resumes once visible.
    mocks.invoke.mockClear();
    await vi.advanceTimersByTimeAsync(CYCLE_INTERVAL_MS);
    expect(mocks.invoke).toHaveBeenCalled();

    // A peer discovered on show needs a follow-up after the loop's own catch-up.
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    mocks.invoke.mockResolvedValueOnce([...machines, { id: "new", environmentId: "new-env" }]);
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(mocks.nudge).toHaveBeenCalledOnce();
  } finally {
    hiddenSpy.mockRestore();
  }
});

it("ignores an in-flight recovery refresh after shutdown", async () => {
  stop = startAppSync();
  await flush();
  let finish!: (value: unknown) => void;
  mocks.invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  notifyRemoteRecovered("pc-env");
  stop();
  stop = undefined;
  mocks.nudge.mockClear();
  finish(machines);
  await flush();
  expect(mocks.recover).not.toHaveBeenCalled();
  expect(mocks.nudge).not.toHaveBeenCalled();
});
