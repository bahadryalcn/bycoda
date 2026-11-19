// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  adoptRemoteMachineInventory,
  savedMachineForEnvironment,
  useRemoteMachineOnline,
  useRemoteMachines,
} from "./connections";
import { focusMachine } from "./machineFocus";
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
      root.render(
        createElement(
          "div",
          null,
          createElement(Probe, { index: 0 }),
          createElement(Probe, { index: 1 }),
        ),
      ),
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

it("ignores an older inventory reply after a newer refresh and retains the newer route on failure", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const machine: RemoteMachine = {
    id: "racing-host",
    name: "Machine",
    endpoint: "ssh://owner@old",
    environmentId: "racing-env",
  };
  const replacement = { ...machine, endpoint: "ssh://owner@new" };
  let finishOlder!: (machines: RemoteMachine[]) => void;
  vi.mocked(invoke)
    .mockReset()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOlder = resolve;
        }),
    )
    .mockResolvedValueOnce([replacement]);
  const root = createRoot(document.createElement("div"));
  let latest!: ReturnType<typeof useRemoteMachines>;
  function Probe() {
    latest = useRemoteMachines();
    return null;
  }
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => latest.refresh());
    expect(latest.machines).toEqual([replacement]);
    await act(async () => finishOlder([machine]));
    expect(latest.machines).toEqual([replacement]);
    expect(savedMachineForEnvironment(machine.environmentId)).toEqual(replacement);
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Inventory unavailable"));
    await act(async () => latest.refresh());
    expect(latest.error).toBe("Inventory unavailable");
    expect(latest.machines).toEqual([replacement]);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("skips offline status checks at mount, on timers and on machine focus, and slows down while hidden", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const machine = {
    id: "status-host",
    name: "Status probe",
    endpoint: "ssh://owner@status",
    environmentId: "status-env",
  };
  adoptRemoteMachineInventory([machine]);
  const read = vi.fn().mockResolvedValue({ environmentId: machine.environmentId });
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command, args) => {
      if (command === "remote_request") return read(args);
    });
  const root = createRoot(document.createElement("div"));
  function Probe() {
    useRemoteMachineOnline(machine.id);
    return null;
  }
  const advance = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));
  try {
    await act(async () => root.render(createElement(Probe)));
    expect(read).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ method: "environment.describe" }));
    hidden.mockReturnValue(true);
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await advance(29_999);
    expect(read).toHaveBeenCalledOnce();
    read.mockRejectedValueOnce("SSH connection failed");
    await advance(1);
    expect(read).toHaveBeenCalledTimes(2);
    online.mockReturnValue(false);
    const releaseFocus = focusMachine(machine.environmentId);
    releaseFocus();
    await advance(5 * 60_000);
    expect(read).toHaveBeenCalledTimes(2);
    hidden.mockReturnValue(false);
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(read).toHaveBeenCalledTimes(2);
    online.mockReturnValue(true);
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(read).toHaveBeenCalledTimes(3);
  } finally {
    act(() => root.unmount());
    online.mockRestore();
    hidden.mockRestore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
