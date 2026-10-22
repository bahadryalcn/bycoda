import { afterEach, expect, it, vi } from "vitest";
import { remoteRequest } from "../../connections/model/connections";
import {
  subscribeRemoteMachineChannel,
  type MachineChannelListener,
} from "../../connections/model/remoteMachineChannel";
import { listBoardTaskResults, moveTask, subscribeBoardTaskChanges } from "./taskClient";
import type { RemoteMachine } from "../../connections/model/protocol";
vi.mock("../../connections/model/connections", () => ({
  remoteRequest: vi.fn(),
}));
vi.mock("../../connections/model/remoteMachineChannel", () => ({
  subscribeRemoteMachineChannel: vi.fn(),
}));
vi.mock("../../automations/model/machineSnapshot", () => ({
  machineCapabilities: async () => ["machine.changes"],
  machineProjects: async () => [{ id: "p", cwd: "/project", name: "project" }],
}));
afterEach(() => vi.clearAllMocks());
const machine: RemoteMachine = {
  id: "m",
  environmentId: "host",
  name: "Mac",
  endpoint: "https://host",
};
it("reads task lists only after shared metadata invalidations and releases the subscriber", async () => {
  let receive!: MachineChannelListener;
  let receiveError!: (error: unknown) => void;
  const released = vi.fn();
  vi.mocked(subscribeRemoteMachineChannel).mockImplementation(
    (_machine, _demand, listener, onError) => {
      receive = listener;
      receiveError = onError!;
      return released;
    },
  );
  vi.mocked(remoteRequest).mockResolvedValue([]);
  const changed = vi.fn();
  const release = subscribeBoardTaskChanges([machine], changed);
  await Promise.resolve();
  try {
    await listBoardTaskResults([machine]);
    const cached = await listBoardTaskResults([machine]);
    expect(cached[0].cached).toBe(true);
    expect(remoteRequest).toHaveBeenCalledTimes(1);
    const forced = await listBoardTaskResults([machine], [], true);
    expect(forced[0].cached).toBeUndefined();
    expect(remoteRequest).toHaveBeenCalledTimes(2);
    await listBoardTaskResults([machine]);
    expect(remoteRequest).toHaveBeenCalledTimes(2);
    receiveError(new Error("control poll failed"));
    expect(changed).toHaveBeenCalledOnce();
    await listBoardTaskResults([machine]);
    expect(remoteRequest).toHaveBeenCalledTimes(3);
    receive({
      instanceId: "boot",
      reset: false,
      sessions: [],
      projects: [],
      tasks: { etag: "new" },
    });
    expect(changed).toHaveBeenCalledTimes(2);
    await listBoardTaskResults([machine]);
    expect(remoteRequest).toHaveBeenCalledTimes(4);
    receive({
      instanceId: "boot",
      reset: false,
      sessions: [],
      projects: [],
      tasks: { etag: "new" },
    });
    expect(changed).toHaveBeenCalledTimes(2);
  } finally {
    release();
  }
  expect(released).toHaveBeenCalledOnce();
});

it("keeps concurrent list readers consistent after a confirmed task mutation", async () => {
  const raceMachine = { ...machine, id: "mutation-race" };
  let receive!: MachineChannelListener;
  vi.mocked(subscribeRemoteMachineChannel).mockImplementation((_id, _demand, listener) => {
    receive = listener;
    return () => {};
  });
  const oldTask = {
    id: "task",
    title: "Work",
    prompt: "Work",
    projectId: "p",
    harness: "codex",
    model: "codex:test",
    modelSettings: {},
    runtimeMode: "auto",
    maxRunMinutes: 0,
    status: "blocked",
    createdAt: 1,
    updatedAt: 1,
  };
  const freshTask = { ...oldTask, status: "queued", updatedAt: 2 };
  let resolveOld!: (tasks: unknown) => void;
  let listReads = 0;
  vi.mocked(remoteRequest).mockImplementation(async (_id, method) => {
    if (method === "tasks.move") return freshTask;
    if (++listReads === 1) return [oldTask];
    if (listReads === 2)
      return new Promise((resolve) => {
        resolveOld = resolve;
      });
    return [freshTask];
  });
  const release = subscribeBoardTaskChanges([raceMachine], () => {});
  await Promise.resolve();
  try {
    const [initial] = await listBoardTaskResults([raceMachine]);
    receive({
      instanceId: "boot",
      reset: false,
      sessions: [],
      projects: [],
      tasks: { etag: "changed" },
    });
    const oldRead = listBoardTaskResults([raceMachine]);
    await Promise.resolve();
    await moveTask(initial.data[0], "queued");
    const newRead = listBoardTaskResults([raceMachine]);
    resolveOld([oldTask]);
    await Promise.all([oldRead, newRead]);
    const [cached] = await listBoardTaskResults([raceMachine]);
    expect(cached.data[0]).toMatchObject({ status: "queued", updatedAt: 2 });
  } finally {
    release();
  }
});
