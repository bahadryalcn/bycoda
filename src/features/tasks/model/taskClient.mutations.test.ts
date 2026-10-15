import { beforeEach, expect, it, vi } from "vitest";
import { remoteRequest } from "../../connections/model/connections";
import { machineCapabilities, machineProjects } from "../../automations/model/machineSnapshot";
import { invoke } from "@tauri-apps/api/core";
import type { RemoteMachine } from "../../connections/model/protocol";
import { HOST_TASKS_TODO, HOST_TASK_CONTINUATION } from "./hostTasks";
import { moveTask, newTaskDraft, saveTask, type BoardTask } from "./taskClient";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../connections/model/connections", () => ({ remoteRequest: vi.fn() }));
vi.mock("../../connections/model/remoteMachineChannel", () => ({
  subscribeRemoteMachineChannel: vi.fn(),
}));
vi.mock("../../automations/model/machineSnapshot", () => ({
  machineCapabilities: vi.fn(),
  machineProjects: vi.fn(),
  invalidateMachineSnapshot: vi.fn(),
}));

const local: RemoteMachine = {
  id: "local",
  environmentId: "local-env",
  name: "My PC",
  endpoint: "http://127.0.0.1:3776",
  localHost: true,
};
const remote: RemoteMachine = {
  id: "slow-remote",
  environmentId: "remote-env",
  name: "Offline server",
  endpoint: "ssh://server",
  ssh: { target: "me@server", remotePort: 3776 },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(machineProjects).mockResolvedValue([{ id: "p", cwd: "G:/app", name: "app" }]);
  // Any unrelated-host probe would stay pending and prevent the local save.
  vi.mocked(invoke).mockReturnValue(new Promise(() => {}));
});

it("saves a local to-do item while an unrelated remote host cannot answer", async () => {
  vi.mocked(machineCapabilities).mockImplementation(async (machine) => {
    if (machine.id !== local.id) return new Promise(() => {});
    return [HOST_TASKS_TODO, HOST_TASK_CONTINUATION];
  });
  vi.mocked(remoteRequest).mockImplementation(async (_id, _method, params) => ({
    ...(params as { task: object }).task,
    createdAt: 1,
    updatedAt: 1,
  }));
  const draft = {
    ...newTaskDraft("G:/app", "codex", "codex:test"),
    machineId: local.id,
    title: "Do later",
  };
  const saved = await saveTask([remote, local], draft, "todo");
  expect(saved).toMatchObject({ machineId: local.id, title: "Do later", status: "todo" });
  expect(remoteRequest).toHaveBeenCalledWith(
    local.id,
    "tasks.save",
    expect.anything(),
    false,
    true,
  );
  expect(invoke).not.toHaveBeenCalled();
  expect(
    vi.mocked(machineCapabilities).mock.calls.every(([machine]) => machine.id === local.id),
  ).toBe(true);
});

it("refuses to queue a to-do item on an older selected host", async () => {
  vi.mocked(machineCapabilities).mockResolvedValue([]);
  const draft = {
    ...newTaskDraft("G:/app", "codex", "codex:test"),
    machineId: local.id,
    continueUntilDone: false,
  };
  await expect(saveTask([remote, local], draft, "todo")).rejects.toThrow(
    "Update bycoda Host on this computer to add to-do items",
  );
  expect(remoteRequest).not.toHaveBeenCalled();
  expect(machineProjects).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
});

it("replaces cleared host fields immediately when a blocked task is restarted", async () => {
  const task: BoardTask = {
    ...newTaskDraft("G:/app", "codex", "codex:test"),
    id: "task",
    projectId: "p",
    status: "blocked",
    createdAt: 1,
    updatedAt: 2,
    machineId: local.id,
    machineName: "this computer",
    stale: true,
    error: "Earlier failure",
    needsInput: true,
    reviewer: { sessionId: "old-review", runId: "old-run", startedAt: 1 },
    verification: {
      review: { verdict: "fail", note: "Earlier failure", sessionId: "old-review", at: 2 },
    },
    reviewRecheckSupported: true,
  };
  const {
    error,
    needsInput,
    reviewer,
    verification,
    stale,
    machineId,
    machineName,
    cwd,
    reviewRecheckSupported,
    ...host
  } = task;
  vi.mocked(remoteRequest).mockResolvedValue({ ...host, status: "queued", updatedAt: 3 });
  const result = await moveTask(task, "queued");
  expect(result).toMatchObject({
    status: "queued",
    machineId: local.id,
    cwd: "G:/app",
    reviewRecheckSupported: true,
  });
  for (const field of ["error", "needsInput", "reviewer", "verification", "stale"])
    expect(result).not.toHaveProperty(field);
});
