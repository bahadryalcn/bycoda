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
