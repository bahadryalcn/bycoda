// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import type { RemoteMachine } from "../../connections";
import { HOST_SPRINTS, type HostSprint } from "./hostSprints";
import { readSprintCatalogSource, sprintCatalogKey, useSprintCatalog } from "./useSprintCatalog";

const mocks = vi.hoisted(() => ({ request: vi.fn(), capabilities: vi.fn() }));
vi.mock("../../connections/public/connections", () => ({ remoteRequest: mocks.request }));
vi.mock("../../automations/public/hostMachines", () => ({
  machineCapabilities: mocks.capabilities,
}));
vi.mock("../../../shared/hooks/useQueryVisible", () => ({ useQueryVisible: () => true }));

it("keeps equal sprint IDs separate across server owners", () => {
  expect(sprintCatalogKey({ environmentId: "pc" }, { id: "same" })).not.toBe(
    sprintCatalogKey({ environmentId: "mac" }, { id: "same" }),
  );
});

it("reports an unsupported server instead of presenting an empty sprint list as complete", async () => {
  mocks.capabilities.mockResolvedValueOnce([]);
  mocks.request.mockClear();
  const source = await readSprintCatalogSource({
    id: "old",
    environmentId: "old",
    name: "Old server",
  } as RemoteMachine);
  expect(source.error).toContain("Update this server");
  expect(mocks.request).not.toHaveBeenCalled();
});

it("keeps a passing transport error quiet but unavailable, and shows a real failure's message", async () => {
  const machine = { id: "mac", environmentId: "mac", name: "Mac" } as RemoteMachine;
  mocks.capabilities.mockResolvedValue([HOST_SPRINTS]);
  mocks.request.mockRejectedValueOnce(new Error("[RPC_TIMEOUT] The Host did not answer."));
  const transient = await readSprintCatalogSource(machine);
  expect(transient).toMatchObject({ failed: true, error: null });
  mocks.request.mockRejectedValueOnce(new Error("Host rejected request: Sprint store is locked"));
  const rejected = await readSprintCatalogSource(machine);
  expect(rejected).toMatchObject({ failed: true, error: "Sprint store is locked" });
});

it("publishes servers independently, retains offline answers and discards changed routes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const local = {
    id: "local",
    environmentId: "pc",
    name: "PC",
    endpoint: "http://pc",
  } as RemoteMachine;
  const remote = {
    id: "remote",
    environmentId: "mac",
    name: "Mac",
    endpoint: "http://mac",
  } as RemoteMachine;
  mocks.capabilities.mockResolvedValue([HOST_SPRINTS]);
  let resolveRemote!: (value: unknown) => void;
  let offline = false;
  mocks.request.mockImplementation(async (id: string) => {
    if (id === "remote") {
      if (offline) throw new Error("Disconnected");
      return new Promise((resolve) => {
        resolveRemote = resolve;
      });
    }
    return { sprints: [{ id: "same", name: "Local sprint" }] };
  });
  let current!: ReturnType<typeof useSprintCatalog>;
  function Probe({ machines }: { machines: RemoteMachine[] }) {
    const catalog = useSprintCatalog(machines);
    useLayoutEffect(() => {
      current = catalog;
    });
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const render = (machines: RemoteMachine[]) =>
    root.render(createElement(QueryClientProvider, { client }, createElement(Probe, { machines })));
  try {
    await act(async () => render([local, remote]));
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(current.sources.map((source) => source.machine.name)).toEqual(["PC"]);
    await act(async () =>
      resolveRemote({ sprints: [{ id: "same", name: "Remote sprint" } as HostSprint] }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(current.sources).toHaveLength(2);
    offline = true;
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(current.sources.find((source) => source.machine.id === "remote")).toMatchObject({
      sprints: [{ name: "Remote sprint" }],
      error: "Disconnected",
    });
    await act(async () => root.render(null));
    await act(async () => render([local, remote]));
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(current.sources.find((source) => source.machine.id === "remote")?.sprints[0]?.name).toBe(
      "Remote sprint",
    );
    await act(async () => render([local, { ...remote, endpoint: "http://replacement" }]));
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(current.sources.find((source) => source.machine.id === "remote")?.sprints).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
