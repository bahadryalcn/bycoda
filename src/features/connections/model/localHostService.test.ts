// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  recovered: vi.fn(),
  refresh: undefined as undefined | (() => Promise<void>),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("./remoteHealth", () => ({ notifyRemoteRecovered: mocks.recovered }));
vi.mock("../../../shared/lib/foregroundPolling", () => ({
  startForegroundPolling: (refresh: () => Promise<void>) => {
    mocks.refresh = refresh;
    return { stop: vi.fn() };
  },
}));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  mocks.invoke.mockReset();
  mocks.recovered.mockReset();
});

async function poll(state: string) {
  mocks.invoke.mockResolvedValueOnce({ state });
  await act(() => mocks.refresh!());
}

it("lets every view reload once when the Host answers again after an update", async () => {
  const { useLocalHostState } = await import("./localHostService");
  const seen: unknown[] = [];
  function Probe() {
    seen.push(useLocalHostState());
    return null;
  }
  act(() => root.render(createElement(Probe)));
  await poll("running");
  expect(mocks.recovered).not.toHaveBeenCalled();
  await poll("updating");
  expect(seen.at(-1)).toBe("updating");
  await poll("running");
  expect(mocks.recovered).toHaveBeenCalledTimes(1);
  await poll("running");
  expect(mocks.recovered).toHaveBeenCalledTimes(1);
  // A confirmed stop that ends recovers the same way; a single silent poll does too.
  await poll("stopped");
  await poll("stopped");
  expect(seen.at(-1)).toBe("stopped");
  await poll("running");
  expect(mocks.recovered).toHaveBeenCalledTimes(2);
  await poll("starting");
  await poll("running");
  expect(mocks.recovered).toHaveBeenCalledTimes(3);
});

it("does not reload views twice after the owner starts the Host", async () => {
  vi.resetModules();
  const { startLocalHost, useLocalHostState } = await import("./localHostService");
  function Probe() {
    useLocalHostState();
    return null;
  }
  act(() => root.render(createElement(Probe)));
  await poll("stopped");
  await poll("stopped");
  mocks.invoke.mockResolvedValueOnce({ environmentId: "env.local" });
  mocks.invoke.mockResolvedValueOnce({ state: "running" });
  await act(() => startLocalHost());
  await act(async () => {});
  expect(mocks.recovered).toHaveBeenCalledTimes(1);
  expect(mocks.recovered).toHaveBeenCalledWith("env.local");
});
