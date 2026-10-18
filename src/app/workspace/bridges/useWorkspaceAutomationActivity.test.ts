// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  list: vi.fn(),
  tasks: vi.fn(),
  claim: vi.fn(),
}));
vi.mock("../../../features/automations/model/automations", () => ({
  listAutomations: api.list,
  automationTriggers: () => [{ kind: "tasks", event: "task_created" }],
}));
vi.mock("../../../features/tasks/model/taskClient", () => ({
  listBoardTasks: api.tasks,
  taskMachines: async () => [],
}));
vi.mock("../../../features/automations/model/workspaceAutomationEvents", async (original) => ({
  ...(await original()),
  claimWorkspaceAutomationRuns: api.claim,
}));
import { useWorkspaceAutomationActivity } from "./useWorkspaceAutomationActivity";

it("launches successful claims immediately and retains only failed events for the next poll", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const automation = { id: "automation", enabled: true };
  api.list.mockResolvedValue([automation]);
  api.tasks
    .mockResolvedValueOnce([
      { id: "a", cwd: "/repo", machineId: "local", createdAt: 100, status: "queued" },
      { id: "b", cwd: "/repo", machineId: "local", createdAt: 100, status: "queued" },
    ])
    .mockResolvedValue([]);
  api.claim
    .mockImplementationOnce(async (_automations, events, failure) => {
      failure(events[1], new Error("temporary claim failure"));
      return [{ automation, run: { id: "a" }, prompt: "a" }];
    })
    .mockResolvedValueOnce([{ automation, run: { id: "b" }, prompt: "b" }]);
  const launch = vi.fn(async () => {});
  const recover = vi.fn(async () => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  function Harness() {
    useWorkspaceAutomationActivity({ ensureAutomationRecovery: recover, launchAutomation: launch });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Harness)));
    expect(launch.mock.calls.map((call) => (call as unknown[])[1])).toEqual([{ id: "a" }]);
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(api.claim.mock.calls[1]?.[1].map((event: { key: string }) => event.key)).toEqual([
      "tasks:local:b:created",
    ]);
    const recoveryToken = api.claim.mock.calls[0]?.[3];
    expect(recoveryToken).toMatch(/^[a-f0-9-]{36}$/);
    expect(api.claim.mock.calls[1]?.[3]).toBe(recoveryToken);
    expect(launch).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(api.claim).toHaveBeenCalledTimes(2);
  } finally {
    warn.mockRestore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
