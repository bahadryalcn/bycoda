// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { focusManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  planningCoordinator,
  planningTaskRef,
  useSprintBoard,
  type SprintBoardController,
} from "./sprintClient";
import {
  HOST_SPRINTS,
  HOST_TASK_HISTORY,
  type HostSprint,
  type SprintFields,
  type SprintProjectRef,
} from "./hostSprints";
import type { RemoteMachine } from "../../connections/model/protocol";
import type { BoardTask } from "./taskClient";

const mocks = vi.hoisted(() => ({ request: vi.fn(), capabilities: vi.fn() }));
vi.mock("../../connections/model/connections", () => ({ remoteRequest: mocks.request }));
vi.mock("../../automations/model/machineSnapshot", () => ({
  machineCapabilities: mocks.capabilities,
}));

const local: RemoteMachine = {
  id: "local",
  name: "This computer",
  localHost: true,
  endpoint: "http://127.0.0.1:3774",
  environmentId: "windows",
};
const remote: RemoteMachine = {
  id: "remote",
  name: "MacBook",
  endpoint: "http://mac:3774",
  environmentId: "mac",
};
let root: Root | undefined;
let container: HTMLDivElement;
let board: SprintBoardController;
function Harness({
  machines = [local, remote],
  projects = [],
  tasks = [],
}: { machines?: RemoteMachine[]; projects?: SprintProjectRef[]; tasks?: BoardTask[] } = {}) {
  const current = useSprintBoard(machines, tasks, projects);
  useEffect(() => {
    board = current;
  });
  return null;
}
beforeEach(() => {
  localStorage.clear();
  focusManager.setFocused(true);
  mocks.capabilities.mockReset().mockResolvedValue([HOST_SPRINTS]);
  mocks.request.mockReset().mockImplementation(async (_id, method) => {
    if (method === "sprints.list") return { sprints: [], planning: [], sources: [] };
    throw new Error(`Unexpected ${method}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
  focusManager.setFocused(undefined);
});

describe("sprint planning authority", () => {
  it("keeps coordinator loading visible until both read lanes settle", async () => {
    const replies: ((value: unknown) => void)[] = [];
    mocks.request.mockImplementation(async (_id, method) => {
      if (method === "sprints.list")
        return new Promise((resolve) => {
          replies.push(resolve);
        });
      throw new Error(`Unexpected ${method}`);
    });
    await act(async () => root!.render(createElement(Harness)));
    let readback!: Promise<void>;
    await act(async () => {
      readback = board.refresh(false);
    });
    expect(replies).toHaveLength(2);
    expect(board.loading).toBe(true);
    await act(async () => {
      replies[1]({ sprints: [], planning: [], sources: [] });
      await readback;
    });
    expect(board.loading).toBe(true);
    const sync = board.refresh();
    await act(async () => {
      replies[0]({ sprints: [], planning: [], sources: [] });
    });
    // Catch-up's final coordinator read also owns a loading token.
    expect(replies).toHaveLength(3);
    expect(board.loading).toBe(true);
    await act(async () => {
      replies[2]({ sprints: [], planning: [], sources: [] });
      await sync;
    });
    expect(board.loading).toBe(false);
  });
  it("publishes coordinator data and coalesces catch-up while a source is slow", async () => {
    const project = { environmentId: "mac", projectId: "b", cwd: "/b", name: "B" };
    const sprint = { id: "sprint", name: "Available now", projects: [project] } as HostSprint;
    let resolveEvents!: (value: unknown) => void;
    mocks.capabilities.mockResolvedValue([HOST_SPRINTS, HOST_TASK_HISTORY]);
    mocks.request.mockImplementation(async (_id, method) => {
      if (method === "sprints.list")
        return {
          sprints: [sprint],
          planning: [],
          sources: [
            { environmentId: "mac", cursor: 0, syncedAt: Date.now(), visibleProjectIds: ["b"] },
          ],
        };
      if (method === "tasks.events")
        return new Promise((resolve) => {
          resolveEvents = resolve;
        });
      if (method === "sprints.ingest") return {};
      throw new Error(`Unexpected ${method}`);
    });
    await act(async () => root!.render(createElement(Harness, { projects: [project] })));
    expect(board.sprints).toEqual([sprint]);
    expect(board.loading).toBe(false);
    let refresh!: Promise<void>;
    await act(async () => {
      refresh = board.refresh();
      for (let tick = 0; tick < 20; tick++) expect(board.refresh()).toBe(refresh);
    });
    expect(mocks.request.mock.calls.filter((call) => call[1] === "tasks.events")).toHaveLength(1);
    await act(async () => {
      resolveEvents({ cursor: 0, events: [], hasMore: false });
      await refresh;
    });
    expect(mocks.request.mock.calls.filter((call) => call[1] === "tasks.events")).toHaveLength(1);
    expect(mocks.request.mock.calls.filter((call) => call[1] === "sprints.list")).toHaveLength(2);
  });
  it("reads an acknowledged create back without waiting for source history, but lifecycle still waits", async () => {
    const project = { environmentId: "mac", projectId: "b", cwd: "/b", name: "B" };
    const sprint = { id: "sprint", name: "New", projects: [project], revision: 1 } as HostSprint;
    let failEvents!: (reason: Error) => void;
    let created = false;
    mocks.capabilities.mockResolvedValue([HOST_SPRINTS, HOST_TASK_HISTORY]);
    mocks.request.mockImplementation(async (_id, method) => {
      if (method === "sprints.list")
        return {
          sprints: created ? [sprint] : [],
          planning: [],
          sources: [
            { environmentId: "mac", cursor: 0, syncedAt: Date.now(), visibleProjectIds: ["b"] },
          ],
        };
      if (method === "tasks.events")
        return new Promise((_resolve, reject) => {
          failEvents = reject;
        });
      if (method === "sprints.create") {
        created = true;
        return sprint;
      }
      throw new Error(`Unexpected ${method}`);
    });
    await act(async () => root!.render(createElement(Harness, { projects: [project] })));
    await act(async () => {
      await board.create({
        name: "New",
        projects: [project],
        capacityPoints: null,
        projectCapacities: {},
      });
    });
    expect(board.sprints).toEqual([sprint]);
    let result!: Promise<unknown>;
    await act(async () => {
      result = board.command(sprint, "start").catch((error) => error);
    });
    expect(mocks.request.mock.calls.some((call) => call[1] === "sprints.start")).toBe(false);
    await act(async () => {
      failEvents(new Error("Offline"));
      expect(await result).toEqual(
        expect.objectContaining({ message: expect.stringContaining("Synchronize") }),
      );
    });
    expect(mocks.request.mock.calls.some((call) => call[1] === "sprints.start")).toBe(false);
  });
  it("retires an in-flight source when the visible project scope changes", async () => {
    const project = { environmentId: "mac", projectId: "b", cwd: "/b", name: "B" };
    let resolveEvents!: (value: unknown) => void;
    mocks.capabilities.mockResolvedValue([HOST_SPRINTS, HOST_TASK_HISTORY]);
    mocks.request.mockImplementation(async (_id, method) => {
      if (method === "sprints.list")
        return {
          sprints: [],
          planning: [],
          sources: [
            { environmentId: "mac", cursor: 0, syncedAt: Date.now(), visibleProjectIds: ["b"] },
          ],
        };
      if (method === "tasks.events")
        return new Promise((resolve) => {
          resolveEvents = resolve;
        });
      if (method === "sprints.ingest") return {};
      throw new Error(`Unexpected ${method}`);
    });
    await act(async () => root!.render(createElement(Harness, { projects: [project] })));
    const oldRead = board.refresh();
    await act(async () => root!.render(createElement(Harness, { projects: [] })));
    await act(async () => {
      resolveEvents({ cursor: 0, events: [], hasMore: false });
      await oldRead;
    });
    expect(mocks.request.mock.calls.some((call) => call[1] === "sprints.ingest")).toBe(false);
    expect(board.syncErrors).toEqual([]);
  });
  it("follows a pre-mutation coordinator read with one fresh readback", async () => {
    await act(async () => root!.render(createElement(Harness)));
    let resolveOld!: (value: unknown) => void;
    const saved = { id: "new", name: "New", projects: [] } as unknown as HostSprint;
    let reads = 0;
    mocks.request.mockImplementation(async (_id, method) => {
      if (method === "sprints.list") {
        if (++reads === 1)
          return new Promise((resolve) => {
            resolveOld = resolve;
          });
        return { sprints: [saved], planning: [], sources: [] };
      }
      if (method === "sprints.create") return saved;
      throw new Error(`Unexpected ${method}`);
    });
    let old!: Promise<void>;
    let created!: Promise<HostSprint>;
    await act(async () => {
      old = board.refresh(false);
    });
    await act(async () => {
      created = board.create({
        name: "New",
        projects: [],
        capacityPoints: null,
        projectCapacities: {},
      });
    });
    expect(reads).toBe(1);
    await act(async () => {
      resolveOld({ sprints: [], planning: [], sources: [] });
      await Promise.all([old, created]);
    });
    expect(reads).toBe(2);
    expect(board.sprints).toEqual([saved]);
  });
  it("uses stable environment identity and never falls back from a missing chosen Host", () => {
    expect(planningCoordinator([local, remote], "")).toEqual(local);
    expect(planningCoordinator([local, remote], "missing")).toBeUndefined();
    expect(
      planningTaskRef({ machineId: "remote", projectId: "same-id", id: "task" }, [local, remote]),
    ).toEqual({ environmentId: "mac", projectId: "same-id", taskId: "task" });
    expect(
      planningTaskRef({ machineId: "local", projectId: "same-id", id: "task" }, [local, remote])
        ?.environmentId,
    ).toBe("windows");
  });
  it("defers initial reads while hidden then reads the chosen coordinator", async () => {
    focusManager.setFocused(false);
    await act(async () => root!.render(createElement(Harness)));
    expect(mocks.request).not.toHaveBeenCalled();
    await act(async () => focusManager.setFocused(true));
    expect(mocks.request).toHaveBeenCalledWith("local", "sprints.list");
    expect(board.supported).toBe(true);
  });
  it("retains a saved unavailable authority without creating a second local board", async () => {
    localStorage.setItem("bycoda.tasks.planning-environment.v1", "missing");
    await act(async () => root!.render(createElement(Harness)));
    expect(board.coordinator).toBeUndefined();
    expect(board.coordinatorEnvironmentId).toBe("missing");
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("pins the first local authority even if the local machine is replaced", async () => {
    await act(async () => root!.render(createElement(Harness)));
    expect(localStorage.getItem("bycoda.tasks.planning-environment.v1")).toBe("windows");
    mocks.request.mockClear();
    await act(async () =>
      root!.render(
        createElement(Harness, {
          machines: [{ ...local, id: "replacement", environmentId: "windows-new" }, remote],
        }),
      ),
    );
    expect(board.coordinator).toBeUndefined();
    expect(board.coordinatorEnvironmentId).toBe("windows");
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("reuses create identity after an uncertain acknowledgement", async () => {
    await act(async () => root!.render(createElement(Harness)));
    const fields: SprintFields = {
      name: "Sprint A",
      projects: [{ environmentId: "windows", projectId: "a", cwd: "C:/a", name: "A" }],
      capacityPoints: null,
      projectCapacities: {},
    };
    mocks.request.mockImplementation(async (_id, method, params) => {
      if (method === "sprints.list") return { sprints: [], planning: [], sources: [] };
      if (method === "sprints.create") {
        if (mocks.request.mock.calls.filter((call) => call[1] === method).length === 1)
          throw new Error("Connection closed");
        return { ...params.input, revision: 1, state: "planned" };
      }
    });
    await expect(board.create(fields)).rejects.toThrow("Connection closed");
    await act(async () => {
      await board.create(fields);
    });
    const writes = mocks.request.mock.calls.filter((call) => call[1] === "sprints.create");
    expect(writes).toHaveLength(2);
    expect(writes[0][2].input.id).toBe(writes[1][2].input.id);
    expect(writes[0][2].input.requestId).toBe(writes[1][2].input.requestId);
  });
  it("replays the persisted source cursor after remount instead of replacing history with a later snapshot", async () => {
    mocks.capabilities.mockResolvedValue([HOST_SPRINTS, HOST_TASK_HISTORY]);
    mocks.request.mockImplementation(async (_id, method) => {
      if (method === "sprints.list")
        return {
          sprints: [],
          planning: [],
          sources: [{ environmentId: "windows", cursor: 5, syncedAt: 1, visibleProjectIds: ["a"] }],
        };
      if (method === "tasks.events")
        return {
          cursor: 6,
          hasMore: false,
          events: [
            {
              sequence: 6,
              projectId: "a",
              taskId: "existing",
              status: "done",
              effectiveAt: 2,
              deleted: false,
            },
          ],
        };
      if (method === "sprints.ingest") return {};
      throw new Error(`Unexpected ${method}`);
    });
    await act(async () =>
      root!.render(
        createElement(Harness, {
          projects: [{ environmentId: "windows", projectId: "a", cwd: "C:/a", name: "A" }],
        }),
      ),
    );
    expect(mocks.request.mock.calls.some((call) => call[1] === "tasks.snapshotWithCursor")).toBe(
      false,
    );
    expect(mocks.request).toHaveBeenCalledWith("local", "tasks.events", {
      after: 5,
      limit: 500,
      projectIds: ["a"],
    });
    expect(mocks.request).toHaveBeenCalledWith("local", "sprints.ingest", {
      input: expect.objectContaining({ fromCursor: 5, cursor: 6 }),
    });
    expect(board.syncErrors).toEqual([]);
  });
  it("rejects a source sequence gap before filtering and does not advance the coordinator", async () => {
    mocks.capabilities.mockResolvedValue([HOST_SPRINTS, HOST_TASK_HISTORY]);
    mocks.request.mockImplementation(async (_id, method) => {
      if (method === "sprints.list")
        return {
          sprints: [],
          planning: [],
          sources: [{ environmentId: "windows", cursor: 5, syncedAt: 1, visibleProjectIds: ["a"] }],
        };
      if (method === "tasks.events")
        return {
          cursor: 7,
          hasMore: false,
          events: [
            {
              sequence: 7,
              projectId: "hidden",
              taskId: "missing",
              status: "done",
              effectiveAt: 2,
              deleted: false,
            },
          ],
        };
      throw new Error(`Unexpected ${method}`);
    });
    await act(async () =>
      root!.render(
        createElement(Harness, {
          projects: [{ environmentId: "windows", projectId: "a", cwd: "C:/a", name: "A" }],
        }),
      ),
    );
    expect(mocks.request.mock.calls.some((call) => call[1] === "sprints.ingest")).toBe(false);
    expect(board.syncErrors.join()).toContain("history has a gap");
  });
  it("does not publish an old authority's in-flight planning mutation into the replacement board", async () => {
    const task = { id: "task", projectId: "a", machineId: "local", title: "Task" } as BoardTask;
    const projects = [{ environmentId: "windows", projectId: "a", cwd: "C:/a", name: "A" }];
    let resolvePlan: (value: unknown) => void = () => {};
    mocks.capabilities.mockResolvedValue([HOST_SPRINTS, HOST_TASK_HISTORY]);
    mocks.request.mockImplementation(async (_id, method) => {
      if (method === "sprints.list") return { sprints: [], planning: [], sources: [] };
      if (method === "tasks.snapshotWithCursor")
        return {
          tasks: [{ id: "task", projectId: "a", title: "Task", status: "todo", updatedAt: 1 }],
          cursor: 1,
        };
      if (method === "tasks.events") return { cursor: 1, hasMore: false, events: [] };
      if (method === "sprints.ingest") return {};
      if (method === "sprints.plan")
        return new Promise((resolve) => {
          resolvePlan = resolve;
        });
      throw new Error(`Unexpected ${method}`);
    });
    await act(async () => root!.render(createElement(Harness, { projects, tasks: [task] })));
    let operation: ReturnType<SprintBoardController["plan"]>;
    await act(async () => {
      operation = board.plan(task, "sprint", 3);
    });
    await act(async () => board.setCoordinatorEnvironmentId("mac"));
    await act(async () => {
      resolvePlan({
        environmentId: "windows",
        projectId: "a",
        taskId: "task",
        sprintId: "sprint",
        storyPoints: 3,
        revision: 1,
      });
      await operation!;
    });
    expect(board.coordinatorEnvironmentId).toBe("mac");
    expect(board.planning.size).toBe(0);
  });
  it("marks a bounded catch-up incomplete and asks for another refresh", async () => {
    mocks.capabilities.mockResolvedValue([HOST_SPRINTS, HOST_TASK_HISTORY]);
    mocks.request.mockImplementation(async (_id, method, params) => {
      if (method === "sprints.list")
        return {
          sprints: [],
          planning: [],
          sources: [{ environmentId: "windows", cursor: 5, syncedAt: 1, visibleProjectIds: ["a"] }],
        };
      if (method === "tasks.events")
        return {
          cursor: params.after + 1,
          hasMore: true,
          events: [
            {
              sequence: params.after + 1,
              projectId: "a",
              taskId: "existing",
              status: "done",
              effectiveAt: 2,
              deleted: false,
            },
          ],
        };
      if (method === "sprints.ingest") return {};
      throw new Error(`Unexpected ${method}`);
    });
    await act(async () =>
      root!.render(
        createElement(Harness, {
          projects: [{ environmentId: "windows", projectId: "a", cwd: "C:/a", name: "A" }],
        }),
      ),
    );
    const ingests = mocks.request.mock.calls.filter((call) => call[1] === "sprints.ingest");
    expect(ingests).toHaveLength(10);
    expect(ingests.at(-1)?.[2].input).toMatchObject({ cursor: 15, caughtUp: false });
    expect(board.syncErrors.join()).toContain("More task history remains");
  });
  it("does not block an online sprint because an unrelated project's machine is offline", async () => {
    const projects: SprintProjectRef[] = [
      { environmentId: "windows", projectId: "a", cwd: "C:/a", name: "A" },
      { environmentId: "mac", projectId: "b", cwd: "/b", name: "B" },
    ];
    const sprint: HostSprint = {
      id: "only-a",
      name: "Only A",
      projects: [projects[0]],
      capacityPoints: null,
      projectCapacities: {},
      state: "planned",
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    mocks.capabilities.mockResolvedValue([HOST_SPRINTS, HOST_TASK_HISTORY]);
    mocks.request.mockImplementation(async (id, method) => {
      if (method === "sprints.list")
        return {
          sprints: [sprint],
          planning: [],
          sources: [
            { environmentId: "windows", cursor: 5, syncedAt: Date.now(), visibleProjectIds: ["a"] },
            { environmentId: "mac", cursor: 3, syncedAt: Date.now(), visibleProjectIds: ["b"] },
          ],
        };
      if (method === "tasks.events") {
        if (id === "remote") throw new Error("Offline");
        return { cursor: 5, hasMore: false, events: [] };
      }
      if (method === "sprints.ingest") return {};
      if (method === "sprints.start") return { ...sprint, state: "active" };
      throw new Error(`Unexpected ${method}`);
    });
    await act(async () => root!.render(createElement(Harness, { projects })));
    expect(board.syncFailures.mac).toContain("Offline");
    expect(board.lifecycleIssue(sprint)).toBeNull();
    await act(async () => {
      await board.command(sprint, "start");
    });
    expect(
      mocks.request.mock.calls.some((call) => call[0] === "local" && call[1] === "sprints.start"),
    ).toBe(true);
  });
});
