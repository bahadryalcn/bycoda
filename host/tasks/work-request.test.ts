import { afterEach, describe, expect, it } from "vitest";
import { HostStore } from "../store";
import { HostEngine } from "../engine";
import { HostTasks } from "./service";
import { createWork, workPrompt, type WorkRequest } from "./work-request";

const stores: HostStore[] = [];
afterEach(async () => {
  for (const store of await stores.splice(0)) await store.close();
});

async function setup() {
  const store = new HostStore(":memory:");
  stores.push(store);
  const project = await store.addProject(process.cwd(), "Work request checks");
  const tasks = new HostTasks(store, new HostEngine(store, {}), () => 1000);
  const work = (patch: Partial<WorkRequest> = {}): WorkRequest => ({
    id: "task-a",
    projectId: project.id,
    request: "Fix the login button label.",
    title: "Fix the login button label.",
    source: { kind: "session", sessionId: "session-a" },
    execution: {
      harness: "claude",
      model: "claude:test",
      modelSettings: {},
      runtimeMode: "auto",
    },
    ...patch,
  });
  return { store, tasks, work, deps: { store, tasks } };
}

describe("createWork", () => {
  it("stores the owner's words unchanged and where they came from", async () => {
    const { tasks, work, deps } = await setup();
    const task = await createWork(deps, work(), { requestId: "r1" });
    expect(task.request).toBe("Fix the login button label.");
    expect(task.prompt).toBe("Fix the login button label.");
    expect(task.origin).toEqual({ kind: "session", sessionId: "session-a" });
    expect(await tasks.get("task-a")).toMatchObject({ status: "todo", review: true });
  });

  it("appends context after the request and keeps the request itself", async () => {
    const { work, deps } = await setup();
    const task = await createWork(deps, work({ context: "Second bug in src/Login.tsx." }), {
      requestId: "r1",
    });
    expect(task.request).toBe("Fix the login button label.");
    expect(task.prompt).toBe(workPrompt(task.request!, "Second bug in src/Login.tsx."));
  });

  it("never lets a caller turn on delivery or open-ended retries", async () => {
    const { work, deps } = await setup();
    const task = await createWork(
      deps,
      work({
        options: { review: false, ...({ autoMerge: true, continueUntilDone: true } as object) },
      }),
      { requestId: "r1" },
    );
    expect(task.autoMerge).not.toBe(true);
    expect(task.continueUntilDone).not.toBe(true);
  });

  for (const kind of ["session", "voice", "room", "automation", "steward"] as const) {
    it(`creates one task when the same ${kind} request is delivered twice`, async () => {
      const { tasks, work, deps } = await setup();
      const request = work({ source: { kind } });
      const first = await createWork(deps, request, { requestId: "same" });
      const again = await createWork(deps, request, { requestId: "same" });
      expect(again.id).toBe(first.id);
      expect(await tasks.list()).toHaveLength(1);
    });
  }

  it("refuses a reused request id with different input", async () => {
    const { tasks, work, deps } = await setup();
    await createWork(deps, work(), { requestId: "same" });
    await expect(
      createWork(deps, work({ request: "Something else." }), { requestId: "same" }),
    ).rejects.toThrow("reused");
    expect(await tasks.list()).toHaveLength(1);
  });

  it("refuses an id that already belongs to another task and leaves no receipt behind", async () => {
    const { store, tasks, work, deps } = await setup();
    await createWork(deps, work(), { requestId: "first" });
    await expect(createWork(deps, work(), { requestId: "second" })).rejects.toThrow();
    const receipts = await store.db
      .prepare("SELECT key FROM metadata WHERE key LIKE 'work-request:%'")
      .all();
    expect(receipts).toHaveLength(1);
    expect(await tasks.list()).toHaveLength(1);
  });
});

describe("createWork executor, helpers and model choice", () => {
  const crewRunner = () => ({
    validate: async () => {},
    choices: async () => [],
    start: async () => {
      throw new Error("not started here");
    },
    state: async () => ({ status: "active" as const }),
    stop: async () => {},
  });

  it("follows Settings for the model unless the surface sends its own choice", async () => {
    const { work, deps } = await setup();
    const task = await createWork(deps, work(), { requestId: "r1" });
    expect(task.modelChoice).toEqual({ kind: "default" });
    expect(task.executor).toBeUndefined();
    expect(task.helpers).toBeUndefined();
    const fixed = await createWork(
      deps,
      work({
        id: "task-b",
        execution: { ...work().execution, modelChoice: { kind: "fixed" } },
      }),
      { requestId: "r2" },
    );
    expect(fixed.modelChoice).toEqual({ kind: "fixed" });
  });

  it("stores helpers only when the work departs from Settings", async () => {
    const { work, deps } = await setup();
    const same = await createWork(deps, work({ helpers: { mode: "settings" } }), {
      requestId: "r1",
    });
    expect(same.helpers).toBeUndefined();
    const off = await createWork(deps, work({ id: "task-b", helpers: { mode: "off" } }), {
      requestId: "r2",
    });
    expect(off.helpers).toEqual({ mode: "off" });
  });

  it("creates crew work without review, and names the option a crew cannot honor", async () => {
    const { tasks, work, deps } = await setup();
    tasks.crewRunner = crewRunner();
    const executor = { kind: "crew" as const, crewDefinitionId: "web" };
    const task = await createWork(deps, work({ executor, options: { isolate: false } }), {
      requestId: "r1",
    });
    expect(task).toMatchObject({ executor, review: false, isolate: false });
    await expect(
      createWork(deps, work({ id: "task-b", executor, options: { isolate: true } }), {
        requestId: "r2",
      }),
    ).rejects.toThrow(/^isolate: /);
    await expect(
      createWork(deps, work({ id: "task-c", executor, options: { review: true } }), {
        requestId: "r3",
      }),
    ).rejects.toThrow(/^review: /);
    await expect(
      createWork(
        deps,
        work({
          id: "task-d",
          executor,
          execution: { ...work().execution, modelChoice: { kind: "fixed" } },
        }),
        { requestId: "r4" },
      ),
    ).rejects.toThrow(/^model: /);
    // Nothing was created for a refused request.
    expect(await tasks.list()).toHaveLength(1);
  });

  it("lets auto keep review and isolation; the Host decides when it starts", async () => {
    const { work, deps } = await setup();
    const task = await createWork(
      deps,
      work({ executor: { kind: "auto" }, options: { isolate: true, review: true } }),
      { requestId: "r1" },
    );
    expect(task).toMatchObject({ executor: { kind: "auto" }, review: true, isolate: true });
  });
});
