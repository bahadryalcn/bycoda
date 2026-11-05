import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import { HostEngine } from "../../engine";
import { HostTasks } from "../../tasks/tasks";
import { createHostTasksService } from "./service";
import { HostTaskSchema, TaskPayloadSchema } from "../../../src/shared/model/host-contracts/tasks";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bycoda-tasks-domain-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const store = new HostStore(join(root, "host.db"));
  cleanup.push(() => store.close());
  const send = vi.fn(async () => {
    throw new Error("No provider dispatch permitted in this fixture");
  });
  const engine = new HostEngine(store, {
    claude: {
      send,
      cancel: vi.fn(),
      stop: vi.fn(),
      bind: vi.fn(),
      approve: vi.fn(),
      answer: vi.fn(),
    },
  });
  const tasks = new HostTasks(store, engine);
  cleanup.push(() => tasks.close());
  await tasks.ready;
  const project = await store.addProject(root, "Fixture");
  const context = { authorized: vi.fn(async () => true) };
  const service = createHostTasksService({
    project: (id) => store.project(id),
    withAuthorization: (authorized, work) => store.db.withAuthorization(authorized, work),
    tasks,
    retarget: () => Promise.reject(new Error("Workspace owner fixture is unavailable")),
  });
  const input = {
    id: "task",
    title: "Fixture",
    prompt: "Keep this payload",
    projectId: project.id,
    harness: "claude",
    model: "fixture",
    modelSettings: {},
    runtimeMode: "auto",
    maxRunMinutes: 0,
    isolate: false,
    review: false,
  };
  return { store, tasks, service, context, input, send };
}
it("delegates real task persistence and coherent snapshot/events without starting a provider", async () => {
  const f = await fixture();
  const saved = await f.service.save({ task: f.input }, f.context);
  expect(HostTaskSchema.parse(saved)).toEqual(saved);
  expect(TaskPayloadSchema.parse({ ...saved, expectedConfiguration: saved })).toEqual({
    ...saved,
    expectedConfiguration: saved,
  });
  expect((await f.service.list({ projectId: f.input.projectId }, f.context))[0].prompt).toBe(
    f.input.prompt,
  );
  const snapshot = await f.service.snapshotWithCursor({}, f.context);
  expect(snapshot.tasks[0]).toMatchObject({ id: saved.id, projectId: saved.projectId });
  const events = await f.service.events({ after: 0 }, f.context);
  expect(events.events.some((event) => event.taskId === saved.id)).toBe(true);
  await expect(f.service.events({ after: events.cursor + 100 }, f.context)).rejects.toThrow(
    "ahead",
  );
  expect(f.send).not.toHaveBeenCalled();
});
it("revoked queued authorization cannot reach actual task persistence", async () => {
  const f = await fixture();
  let release!: () => void, enter!: () => void;
  const wait = new Promise<void>((done) => {
    release = done;
  });
  const entered = new Promise<void>((done) => {
    enter = done;
  });
  const blocker = f.store.db.scope(async () => {
    enter();
    await wait;
  });
  await entered;
  const saving = Promise.withResolvers<void>();
  const save = f.tasks.save.bind(f.tasks);
  vi.spyOn(f.tasks, "save").mockImplementation((raw) => {
    const result = save(raw);
    saving.resolve();
    return result;
  });
  const pending = f.service.save({ task: f.input }, f.context);
  const rejected = expect(pending).rejects.toThrow("revoked");
  await saving.promise;
  f.context.authorized.mockResolvedValue(false);
  release();
  await blocker;
  await rejected;
  expect(await f.tasks.get(f.input.id)).toBeUndefined();
  expect(f.send).not.toHaveBeenCalled();
});
it("retains owner transition rules and strict versus legacy outer parameters", async () => {
  const f = await fixture();
  await expect(f.service.save({ task: f.input, extension: true }, f.context)).rejects.toThrow();
  await f.service.save({ task: f.input, extension: true }, f.context, { legacy: true });
  await expect(f.service.move({ taskId: "task", to: "done" }, f.context)).rejects.toThrow();
  await expect(f.service.list({ projectId: "missing" }, f.context)).rejects.toThrow();
  const read = f.tasks.list.bind(f.tasks);
  vi.spyOn(f.tasks, "list").mockImplementation(async (...args) => {
    const result = await read(...args);
    f.context.authorized.mockResolvedValue(false);
    return result;
  });
  await expect(f.service.list({}, f.context)).rejects.toThrow("revoked");
  expect(f.send).not.toHaveBeenCalled();
});
