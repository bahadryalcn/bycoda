// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  list: vi.fn(),
  tasks: vi.fn(),
  claim: vi.fn(),
  lead: vi.fn(async () => true),
}));
vi.mock("../../../platform/tauri/workspaceWindows", () => ({ isLeadWindow: api.lead }));
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

it("skips follower source polling and resumes after leader transfer", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.lead.mockResolvedValue(false);
  api.list.mockReset().mockResolvedValue([{ id: "automation", enabled: true }]);
  api.tasks.mockReset().mockResolvedValue([]);
  api.claim.mockReset().mockResolvedValue([]);
  const recover = vi.fn(async () => {}),
    launch = vi.fn(async () => {});
  function Probe() {
    useWorkspaceAutomationActivity({ ensureAutomationRecovery: recover, launchAutomation: launch });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    expect(api.list).not.toHaveBeenCalled();
    expect(api.tasks).not.toHaveBeenCalled();
    api.lead.mockResolvedValue(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(api.tasks).toHaveBeenCalledTimes(1);
    api.lead.mockResolvedValue(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(launch).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    api.lead.mockResolvedValue(true);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("does not start source reads after an original leader check outlives unmount", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let release!: (lead: boolean) => void;
  api.lead.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
  );
  api.list.mockClear();
  api.tasks.mockClear();
  const recover = vi.fn(async () => {}),
    launch = vi.fn(async () => {});
  function Probe() {
    useWorkspaceAutomationActivity({ ensureAutomationRecovery: recover, launchAutomation: launch });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => root.unmount());
    await act(async () => {
      release(true);
    });
    expect(api.list).not.toHaveBeenCalled();
    expect(api.tasks).not.toHaveBeenCalled();
  } finally {
    api.lead.mockResolvedValue(true);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

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
