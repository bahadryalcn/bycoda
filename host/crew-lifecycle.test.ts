import { afterEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import { HostTasks } from "./tasks";
import { HostCrews } from "./crews";
import type { HostProvider } from "./providers";
import { defaultCrewPolicy } from "../src/features/crews/model/crew";

// Exercise real Git and crew state transitions without Windows' intentional
// one-second launch spacing; the gate's timing has its own dedicated tests.
vi.mock("./git-start-gate", async (importOriginal) => {
  const original = await importOriginal<typeof import("./git-start-gate")>();
  return { ...original, hostGitStarts: new original.GitStartGate(0) };
});

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

// Each stage runs real Git and starts a distinct provider session. Await the
// complete tick before testing its deadline: vi.waitFor can expire while its
// async callback is still settling, racing fixture teardown with the last tick.
async function waitForReview(tasks: HostTasks, store: HostStore, taskId: string) {
  const started = Date.now();
  const deadline = started + 45_000;
  while (true) {
    await tasks.tick();
    await tasks.idle();
    const task = await tasks.get(taskId);
    if (task?.status === "review") return;
    if (task?.status === "blocked" || Date.now() >= deadline) {
      const stages = {
        status: task?.status,
        error: task?.error,
        worker: task?.sessionId ? (await store.session(task.sessionId)).status : undefined,
        reviewer: task?.reviewer?.sessionId
          ? (await store.session(task.reviewer.sessionId)).status
          : undefined,
      };
      throw new Error(`Crew fixture did not reach review after ${Date.now() - started}ms: ${JSON.stringify(stages)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
async function setup() {
  const root = resolve("temp/test-results");
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, "crew-lifecycle-"));
  const cwd = join(directory, "project");
  mkdirSync(cwd);
  execFileSync("git", ["init", "-q"], { cwd, windowsHide: true });
  writeFileSync(join(cwd, "backend.ts"), "export const value = 1;\n");
  writeFileSync(join(cwd, "ui.ts"), "export const view = 1;\n");
  const store = new HostStore(join(directory, "host.db"));
  const project = await store.addProject(cwd, "Crew lifecycle");
  const worker: HostProvider = {
    send: vi.fn(async (input) => {
      input.onEvent({ type: "message.delta", text: "Implementation complete" });
      input.onEvent({ type: "message.completed" });
    }),
    cancel: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  const reviewer: HostProvider = {
    ...worker,
    send: vi.fn(async (input) => {
      input.onEvent({ type: "message.delta", text: "Checked the assigned files.\nVERDICT: PASS" });
      input.onEvent({ type: "message.completed" });
    }),
  };
  const engine = new HostEngine(store, { codex: worker, claude: reviewer });
  const tasks = new HostTasks(store, engine);
  const crews = new HostCrews(store, engine, tasks, async () => ({
    models: {
      codex: [{ id: "codex:test", name: "Worker", harness: "codex" }],
      claude: [{ id: "claude:test", name: "Reviewer", harness: "claude" }],
    },
    errors: {},
  }));
  cleanups.push(async () => {
    crews.stop();
    tasks.stop();
    await tasks.idle();
    await engine.close();
    await store.close();
    if (!resolve(directory).startsWith(`${root}\\`) && !resolve(directory).startsWith(`${root}/`))
      throw new Error("Unexpected fixture path");
    rmSync(directory, { recursive: true, force: true });
  });
  const agent = (id: string, role: "coordinator" | "specialist" | "reviewer") => ({
    id,
    name: id,
    role,
    selection: "fixed",
    instructions: "",
    candidates: [
      {
        id,
        harness: role === "reviewer" ? "claude" : "codex",
        model: role === "reviewer" ? "claude:test" : "codex:test",
        modelSettings: {},
        capabilities: {},
      },
    ],
  });
  await crews.save({
    id: "crew",
    name: "Crew",
    projectId: project.id,
    updatedAt: 0,
    policy: defaultCrewPolicy,
    agents: [
      agent("lead", "coordinator"),
      agent("backend", "specialist"),
      agent("reviewer", "reviewer"),
    ],
  });
  const lead = await engine.command({
    type: "create",
    commandId: randomUUID(),
    projectId: project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
    modelSettings: {},
  });
  const principal = { projectId: project.id, sessionId: lead.sessionId };
  await crews.startRun(project.id, "crew", "Implement backend", "run", "supervised", principal);
  const assignment = await crews.assign(
    project.id,
    {
      runId: "run",
      requestId: "backend",
      memberId: "backend",
      title: "Backend",
      prompt: "Implement backend",
      files: ["backend.ts"],
    },
    principal,
  );
  await waitForReview(tasks, store, assignment.taskId);
  return { crews, tasks, project, principal, assignment, cwd, reviewer, worker, store };
}

it("runs a distinct selected reviewer and accepts scoped results despite unrelated edits", async () => {
  const f = await setup();
  expect(f.reviewer.send).toHaveBeenCalledOnce();
  expect((await f.tasks.list())[0]?.reviewerConfig?.harness).toBe("claude");
  await expect(f.tasks.move(f.assignment.taskId, "done")).rejects.toThrow("crew coordinator");
  expect((await f.tasks.get(f.assignment.taskId))?.status).toBe("review");
  writeFileSync(join(f.cwd, "ui.ts"), "export const view = 2;\n");
  await f.crews.call(
    "crews.accept",
    { runId: "run", taskId: f.assignment.taskId },
    f.project.id,
    f.principal,
  );
  expect((await f.tasks.list())[0]?.status).toBe("done");
}, 90000);

it("invalidates stale review when owned content changes and requires an independent recheck", async () => {
  const f = await setup();
  writeFileSync(join(f.cwd, "backend.ts"), "export const value = 2;\n");
  await expect(f.tasks.move(f.assignment.taskId, "done")).rejects.toThrow("crew coordinator");
  expect((await f.tasks.get(f.assignment.taskId))?.status).toBe("review");
  await expect(
    f.crews.call(
      "crews.accept",
      { runId: "run", taskId: f.assignment.taskId },
      f.project.id,
      f.principal,
    ),
  ).rejects.toThrow("changed");
  expect((await f.tasks.list())[0]?.status).toBe("blocked");
  await f.tasks.recheckReview(f.assignment.taskId);
  await waitForReview(f.tasks, f.store, f.assignment.taskId);
  await f.crews.call(
    "crews.accept",
    { runId: "run", taskId: f.assignment.taskId },
    f.project.id,
    f.principal,
  );
  expect(f.reviewer.send).toHaveBeenCalledTimes(2);
}, 90000);

it("starts one independent coordinator on a retried owner launch", async () => {
  const f = await setup();
  const first = await f.crews.startRun(
    f.project.id,
    "crew",
    "New deliverable",
    "new-run",
    "supervised",
  );
  const second = await f.crews.startRun(
    f.project.id,
    "crew",
    "New deliverable",
    "new-run",
    "supervised",
  );
  expect(first.coordinatorSessionId).toBe(second.coordinatorSessionId);
  expect(first.coordinatorSessionId).not.toBe(f.principal.sessionId);
  expect((await f.store.receiptStatus("crew-new-run:create"))?.sessionId).toBe(
    first.coordinatorSessionId,
  );
  await vi.waitFor(
    async () => expect((await f.store.session(first.coordinatorSessionId!)).status).toBe("idle"),
    {
      timeout: 15000,
    },
  );
  expect(f.worker.send).toHaveBeenCalledTimes(2);
}, 90000);

it("lets an agent launch a separate coordinator and reuses host-wide crews in another project", async () => {
  const f = await setup();
  const run = await f.crews.startRun(
    f.project.id,
    "crew",
    "Separate work",
    "separate",
    "supervised",
    f.principal,
    true,
  );
  expect(run.coordinatorSessionId).not.toBe(f.principal.sessionId);
  const replay = await f.crews.startRun(
    f.project.id,
    "crew",
    "Separate work",
    "separate",
    "supervised",
    f.principal,
    true,
  );
  expect(replay.coordinatorSessionId).toBe(run.coordinatorSessionId);
  await expect(
    f.crews.call("crews.get", { runId: run.id }, f.project.id, f.principal),
  ).resolves.toMatchObject({ id: run.id });
  await expect(
    f.crews.call("crews.finish", { runId: run.id }, f.project.id, f.principal),
  ).rejects.toThrow();
  const definition = (await f.crews.list(f.project.id)).definitions[0]!;
  await f.crews.save({ ...definition, id: "shared", projectId: undefined, updatedAt: 0 });
  const otherCwd = join(f.cwd, "other");
  mkdirSync(otherCwd);
  const other = await f.store.addProject(otherCwd, "Other");
  expect((await f.crews.list(other.id)).definitions.map((d) => d.id)).toEqual(["shared"]);
  const remoteRun = await f.crews.startRun(
    other.id,
    "shared",
    "Other work",
    "other-run",
    "supervised",
  );
  expect((await f.store.session(remoteRun.coordinatorSessionId!)).projectId).toBe(other.id);
}, 90000);

it("runs crew tasks with one worker slot and completes only after crew acceptance", async () => {
  const f = await setup();
  await f.crews.call(
    "crews.accept",
    { runId: "run", taskId: f.assignment.taskId },
    f.project.id,
    f.principal,
  );
  await f.tasks.limits.save({ maxRunningTasks: 1 });
  await f.tasks.save({
    id: "parent",
    projectId: f.project.id,
    title: "Team deliverable",
    prompt: "Implement backend",
    harness: "codex",
    model: "codex:test",
    modelSettings: {},
    runtimeMode: "supervised",
    maxRunMinutes: 0,
    isolate: false,
    review: false,
    continueUntilDone: false,
    crewDefinitionId: "crew",
    status: "queued",
  });
  await f.tasks.tick();
  await f.tasks.idle();
  const parent = (await f.tasks.get("parent"))!;
  expect(parent.status).toBe("running");
  expect(parent.crewExecutionId).toBeTruthy();
  expect(parent.sessionId).not.toBe(f.principal.sessionId);
  await vi.waitFor(
    async () => expect((await f.store.session(parent.sessionId!)).status).toBe("idle"),
    {
      timeout: 15000,
    },
  );
  await f.tasks.tick();
  expect((await f.tasks.get("parent"))?.status).toBe("running");
  await expect(f.tasks.move("parent", "done")).rejects.toThrow();
  const principal = { projectId: f.project.id, sessionId: parent.sessionId! };
  await expect(
    f.crews.call("crews.finish", { runId: parent.crewExecutionId }, f.project.id, principal),
  ).rejects.toThrow("Delegate");
  const child = await f.crews.assign(
    f.project.id,
    {
      runId: parent.crewExecutionId,
      requestId: "child",
      memberId: "backend",
      title: "Child",
      prompt: "Implement",
      files: ["backend.ts"],
    },
    principal,
  );
  await waitForReview(f.tasks, f.store, child.taskId);
  await f.crews.call(
    "crews.accept",
    { runId: parent.crewExecutionId, taskId: child.taskId },
    f.project.id,
    principal,
  );
  await f.crews.call("crews.finish", { runId: parent.crewExecutionId }, f.project.id, principal);
  await f.tasks.tick();
  expect((await f.tasks.get("parent"))?.status).toBe("done");
}, 90000);

it("starts independent crew tasks and retries a stopped task with a fresh run", async () => {
  const f = await setup();
  await f.tasks.limits.save({ maxRunningTasks: 2 });
  for (const id of ["one", "two"])
    await f.tasks.save({
      id,
      projectId: f.project.id,
      title: id,
      prompt: "Implement",
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "supervised",
      maxRunMinutes: 0,
      isolate: false,
      review: false,
      continueUntilDone: false,
      crewDefinitionId: "crew",
      status: "queued",
    });
  await f.tasks.tick();
  await f.tasks.idle();
  const first = (await f.tasks.get("one"))!;
  const second = (await f.tasks.get("two"))!;
  expect(first.status).toBe("running");
  expect(second.status).toBe("running");
  expect(first.crewExecutionId).not.toBe(second.crewExecutionId);
  expect(first.sessionId).not.toBe(second.sessionId);
  await f.tasks.move("one", "blocked");
  expect((await f.tasks.get("one"))?.status).toBe("blocked");
  expect(
    (await f.crews.list(f.project.id)).runs.find((r) => r.id === first.crewExecutionId)?.status,
  ).toBe("paused");
  expect(
    (await f.crews.list(f.project.id)).runs.find((r) => r.id === second.crewExecutionId)?.status,
  ).toBe("active");
  await f.tasks.move("one", "queued");
  await f.tasks.tick();
  await f.tasks.idle();
  expect((await f.tasks.get("one"))?.crewExecutionId).not.toBe(first.crewExecutionId);
  expect((await f.tasks.get("one"))?.status).toBe("running");
}, 90000);
