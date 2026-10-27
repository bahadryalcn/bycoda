import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { HostTasks } from "./tasks";
import type { TaskWorkspaceServices } from "./task-workspace-runtime";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture(managed?: TaskWorkspaceServices) {
  const root = await mkdtemp(join(tmpdir(), "bycoda-tasks-authority-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const store = new HostStore(join(root, "host.db"));
  cleanup.push(() => store.close());
  const command = vi.fn(async () => {
    throw new Error("Unexpected provider effect");
  });
  const tasks = new HostTasks(
    store,
    {
      command,
      updateSession: vi.fn(async () => {
        throw new Error("Unexpected session mutation");
      }),
    },
    Date.now,
    undefined,
    managed,
  );
  cleanup.push(() => tasks.close());
  await tasks.ready;
  const project = await store.addProject(root, "Fixture");
  const input = {
    id: "task",
    title: "Fixture",
    prompt: "Preserve",
    projectId: project.id,
    harness: "claude",
    model: "fixture",
    modelSettings: {},
    runtimeMode: "auto",
    maxRunMinutes: 0,
    isolate: false,
    review: false,
  };
  return { store, tasks, input, command };
}
it("checks request authorization again at central write inside an already owned SQL scope", async () => {
  const f = await fixture();
  let allowed = true;
  const project = f.store.project.bind(f.store);
  vi.spyOn(f.store, "project").mockImplementation(async (...args) => {
    const value = await project(...args);
    allowed = false;
    return value;
  });
  await expect(
    f.store.db.withAuthorization(
      async () => allowed,
      () => f.store.db.scope(() => f.tasks.save(f.input)),
    ),
  ).rejects.toThrow();
  expect(await f.tasks.get("task")).toBeUndefined();
  expect(f.command).not.toHaveBeenCalled();
});
it("rechecks a delayed cancellation before sending provider Stop", async () => {
  const f = await fixture();
  await f.tasks.save(f.input);
  await f.store.save(
    {
      projectId: f.input.projectId,
      revision: 1,
      updatedAt: 1,
      status: "running",
      runId: "run",
      session: {
        id: "session",
        cwd: ".",
        title: "Fixture",
        harness: "claude",
        model: "fixture",
        modelSettings: {},
        runtimeMode: "auto",
        blocks: [],
      },
    },
    {},
  );
  await f.store.db
    .prepare(
      "UPDATE tasks SET value=json_set(value,'$.status','running','$.sessionId','session','$.runId','run','$.startedAt',1) WHERE id='task'",
    )
    .run();
  let allowed = true;
  const session = f.store.find.bind(f.store);
  vi.spyOn(f.store, "find").mockImplementation(async (...args) => {
    const value = await session(...args);
    allowed = false;
    return value;
  });
  await expect(
    f.store.db.withAuthorization(
      async () => allowed,
      () => f.tasks.cancel("task", "Stop"),
    ),
  ).rejects.toThrow();
  expect(f.command).not.toHaveBeenCalled();
  expect((await f.tasks.get("task"))?.status).toBe("running");
});
it("checks authority after workspace lookup before closing or removing a task checkout", async () => {
  let allowed = true;
  const close = vi.fn(),
    apply = vi.fn();
  const managed = {
    registry: {
      get: vi.fn(async () => {
        allowed = false;
        return { id: "workspace", revision: 1 };
      }),
      close,
    },
    removal: { apply },
  } as unknown as TaskWorkspaceServices;
  const f = await fixture(managed);
  await f.tasks.save(f.input);
  await f.store.db
    .prepare(
      "UPDATE tasks SET value=json_set(value,'$.status','review','$.branch','fixture','$.workspaceId','workspace') WHERE id='task'",
    )
    .run();
  await expect(
    f.store.db.withAuthorization(
      async () => allowed,
      () => f.tasks.delete("task", true),
    ),
  ).rejects.toThrow();
  expect(close).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
  expect(await f.tasks.get("task")).toBeDefined();
});
it("does not attach a departed caller grant to later autonomous task work", async () => {
  const f = await fixture();
  let allowed = true;
  await f.store.db.withAuthorization(
    async () => allowed,
    () => f.tasks.save(f.input),
  );
  allowed = false;
  expect((await f.tasks.move("task", "todo")).status).toBe("todo");
  expect(f.command).not.toHaveBeenCalled();
});
