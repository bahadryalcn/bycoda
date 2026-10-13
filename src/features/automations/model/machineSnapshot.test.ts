import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteMachine } from "../../connections/model/protocol";

const { request, invokeMock } = vi.hoisted(() => ({
  request: vi.fn(),
  invokeMock: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: invokeMock,
}));
vi.mock("../../connections/model/connections", async (original) => ({
  ...(await original<typeof import("../../connections/model/connections")>()),
  remoteRequest: request,
  recordRemoteCapabilities: vi.fn(),
}));

import { listHostAutomations, probeMachines } from "./hostAutomationClient";
import { MACHINE_SNAPSHOT_TTL_MS, invalidateMachineSnapshot } from "./machineSnapshot";
import { goalMachines, listBoardGoals } from "../../tasks/model/goalClient";
import { listBoardTasks, probeTaskMachines } from "../../tasks/model/taskClient";

const mac: RemoteMachine = {
  id: "machine-mac",
  name: "MacBook",
  endpoint: "http://127.0.0.1:41000",
  environmentId: "env-mac",
  ssh: { target: "me@macbook", remotePort: 3774 },
};
const mini: RemoteMachine = { ...mac, id: "machine-mini", name: "Mini", environmentId: "env-mini" };

function calls(method: string, machineId?: string) {
  return request.mock.calls.filter(
    ([id, name]) => name === method && (!machineId || id === machineId),
  ).length;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T10:00:00Z"));
  invalidateMachineSnapshot();
  request.mockReset();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([mac, mini]);
  request.mockImplementation(async (_id: string, method: string) => {
    if (method === "environment.describe")
      return {
        capabilities: ["tasks", "goals", "tasks.todo", "automations"],
      };
    if (method === "projects.list") return [];
    return [];
  });
});
afterEach(() => vi.useRealTimers());

describe("machine snapshot", () => {
  it("asks each machine once for describe and once for projects across a Tasks refresh", async () => {
    // What TasksView does: three probes, then the task and goal lists.
    const [reach, goalHosts] = await Promise.all([
      probeTaskMachines(),
      goalMachines(),
      probeMachines(),
    ]);
    await Promise.all([
      listBoardTasks(reach.capable),
      listBoardGoals(goalHosts),
      listHostAutomations(reach.capable),
    ]);
    for (const machine of [mac, mini]) {
      expect(calls("environment.describe", machine.id)).toBe(1);
      expect(calls("projects.list", machine.id)).toBe(1);
    }
  });

  it("reuses the answers until the TTL passes, then asks again", async () => {
    await probeMachines();
    await probeMachines();
    expect(calls("environment.describe")).toBe(2);
    vi.advanceTimersByTime(MACHINE_SNAPSHOT_TTL_MS + 1);
    await probeMachines();
    expect(calls("environment.describe")).toBe(4);
  });

  it("asks again after the snapshot is invalidated for a machine", async () => {
    await probeMachines();
    invalidateMachineSnapshot(mac.id);
    await probeMachines();
    expect(calls("environment.describe", mac.id)).toBe(2);
    expect(calls("environment.describe", mini.id)).toBe(1);
  });

  it("does not keep a failed describe", async () => {
    request.mockRejectedValueOnce(new Error("offline"));
    invokeMock.mockResolvedValue([mac]);
    expect((await probeMachines()).unreachable).toEqual(["MacBook"]);
    expect((await probeMachines()).capable).toEqual([mac]);
  });
});

it("forces a retry through the tunnel failure cache while sharing parallel probes", async () => {
  await probeMachines();
  request.mockClear();
  await Promise.all([probeMachines("tasks", true), probeMachines("goals", true)]);
  expect(calls("environment.describe")).toBe(2);
  expect(request).toHaveBeenCalledWith(mac.id, "environment.describe", {}, true);
});

it("retains the actual discovery failure for each unreachable host", async () => {
  request.mockRejectedValue(new Error("Host identity changed"));
  const reach = await probeMachines();
  expect(reach.unreachableErrors).toEqual({
    [mac.id]: "Host identity changed",
    [mini.id]: "Host identity changed",
  });
});
