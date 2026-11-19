// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useRemoteMachines } from "./connections";
import type { RemoteMachine } from "./protocol";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

it("distinguishes a failed initial load and retains canonical IDs after a failed refresh", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const machine: RemoteMachine = {
    id: "host-1",
    name: "Machine",
    endpoint: "ssh://owner@host",
    environmentId: "env-1",
  };
  vi.mocked(invoke).mockRejectedValueOnce(new Error("load failed"));
  const container = document.createElement("div");
  const root = createRoot(container);
  let latest: ReturnType<typeof useRemoteMachines>;
  function Probe() {
    latest = useRemoteMachines();
    return null;
  }
  try {
    await act(async () => root.render(createElement(Probe)));
    expect(latest!.loaded).toBe(false);
    expect(latest!.loading).toBe(false);
    expect(latest!.error).toBe("load failed");
    vi.mocked(invoke).mockResolvedValueOnce([machine]);
    await act(async () => latest!.refresh());
    expect(latest!.loaded).toBe(true);
    expect(latest!.error).toBeUndefined();
    expect(latest!.machines).toEqual([machine]);
    vi.mocked(invoke).mockRejectedValueOnce(new Error("refresh failed"));
    await act(async () => latest!.refresh());
    expect(latest!.loaded).toBe(true);
    expect(latest!.error).toBe("refresh failed");
    expect(latest!.machines[0]).toBe(machine);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("retries an initial machine inventory failure automatically without opening connections", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(invoke)
    .mockReset()
    .mockRejectedValueOnce(new Error("temporarily unavailable"))
    .mockResolvedValue([]);
  const root = createRoot(document.createElement("div"));
  let latest!: ReturnType<typeof useRemoteMachines>;
  function Probe() {
    latest = useRemoteMachines();
    return null;
  }
  try {
    await act(async () => root.render(createElement(Probe)));
    expect(latest.error).toContain("unavailable");
    await act(async () => vi.advanceTimersByTimeAsync(6_000));
    expect(latest.error).toBeUndefined();
    expect(latest.loaded).toBe(true);
    expect(vi.mocked(invoke).mock.calls.every((call) => call[0] === "remote_machines")).toBe(true);
  } finally {
    act(() => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("shares one machine read between instances and does not re-render for an unchanged list", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const machine: RemoteMachine = {
    id: "host-2",
    name: "Shared",
    endpoint: "ssh://owner@shared",
    environmentId: "env-2",
  };
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async () => [{ ...machine }]);
  const root = createRoot(document.createElement("div"));
  let renders = 0;
  const seen: Array<ReturnType<typeof useRemoteMachines>> = [];
  function Probe({ index }: { index: number }) {
    seen[index] = useRemoteMachines();
    renders += 1;
    return null;
  }
  try {
    await act(async () =>
      root.render(createElement("div", null, createElement(Probe, { index: 0 }), createElement(Probe, { index: 1 }))),
    );
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1);
    expect(seen[0].machines).toEqual([machine]);
    expect(seen[1].machines).toBe(seen[0].machines);
    const settledRenders = renders;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(2);
    expect(renders).toBe(settledRenders);
    expect(seen[0].loading).toBe(false);
    expect(seen[1].machines).toBe(seen[0].machines);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
