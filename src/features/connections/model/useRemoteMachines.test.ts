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
