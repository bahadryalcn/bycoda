// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  nudge: vi.fn(),
  recover: vi.fn(),
  stop: vi.fn(),
  capabilities: vi.fn(async () => ["sync"]),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../connections/model/connections", () => ({
  cachedRemoteCapabilities: () => ["sync"],
  loadRemoteCapabilities: mocks.capabilities,
  remoteRequest: vi.fn(),
}));
vi.mock("./syncClient", async (original) => ({
  ...(await original<typeof import("./syncClient")>()),
  startSyncLoop: () => ({ nudge: mocks.nudge, recover: mocks.recover, stop: mocks.stop }),
}));

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
