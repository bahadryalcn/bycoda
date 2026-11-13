import type { TaskWorkspaceServices } from "../tasks/task-workspace-runtime";
import type { BranchDeliveryPlan, BranchMergeReceipt } from "../workspaces/workspace-contracts";
import { HostTasks } from "../tasks/service";
import { bindSessionWork } from "../work/session-adapter";
import { createHostModelRoutingService, hostModelRoutingService } from "../model-routing/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { writerWorkspaces } from "../workspaces/writer-workspaces.test-support";
import { canonicalWorkspacePathSync } from "../workspaces/workspace-paths";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SendTurnInput } from "../../src/integrations/harness/core/types";
import type { HostProvider } from "../providers/providers";
import { HostEngine } from "../engine";
import { HostStore } from "../store";
import { HostAutomations, MISSED_RUN_SKIP, PREVIOUS_RUN_SKIP } from "./automations";
if (process.platform === "win32") vi.setConfig({ testTimeout: 60000 });
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const at = (value: string) => new Date(value).getTime();
const MINUTE = 60000;
it("does not upsert another project's automation through create-only admission", async () => {
  const f = await setup();
  const foreignPath = join(f.directory, "foreign");
  mkdirSync(foreignPath);
  const foreign = await f.store.addProject(foreignPath, "Foreign project");
  const original = await f.automations.save(f.input({ projectId: foreign.id }));
  await expect(
    f.automations.save(f.input({ expectedAbsent: true, name: "Overwritten" })),
  ).rejects.toThrow("Automation ID already exists");
  expect((await f.automations.list())[0]).toEqual(original);
});
it("admits only one concurrent create-only automation for the same ID", async () => {
  const f = await setup();
  const results = await Promise.allSettled([
    f.automations.save(f.input({ expectedAbsent: true, name: "First owner request" })),
    f.automations.save(f.input({ expectedAbsent: true, name: "Second owner request" })),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected")?.reason).toMatchObject({
    message: "Automation ID already exists. Choose a new ID.",
  });
});
it("rejects a changed reviewed automation at pending-run admission without launching", async () => {
  const f = await setup();
  const reviewed = await f.automations.save(f.input());
  const transaction = f.store.transaction.bind(f.store);
  vi.spyOn(f.store, "transaction").mockImplementationOnce(async (operation) => {
    await f.automations.save(f.input({ prompt: "Concurrent owner instructions" }));
    return transaction(operation);
  });
  await expect(f.automations.runNow("nightly", reviewed)).rejects.toThrow("Configuration changed");
  expect(await f.automations.runs("nightly")).toEqual([]);
  expect(f.turns).toHaveLength(0);
  expect((await f.automations.list())[0].prompt).toBe("Concurrent owner instructions");
});
it("drains a held manual launch on close and retains its canonical Task", async () => {
  const f = await setup();
  const tasks = f.tasks;
  await f.automations.save(f.input());
  const entered = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const original = tasks.get.bind(tasks);
  vi.spyOn(tasks, "get").mockImplementation(async (...args) => {
    const task = await original(...args);
    entered.resolve();
    await released.promise;
    return task;
  });
  const running = f.automations.runNow("nightly");
  await entered.promise;
  let closed = false;
  const closing = f.automations.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  released.resolve();
  const run = await running;
  await closing;
  expect(run.status).toBe("pending");
  expect(run.taskId).toBeTruthy();
  expect((await f.automations.runs("nightly"))[0]).toMatchObject({
    id: run.id,
    taskId: run.taskId,
    status: "pending",
  });
  expect(await tasks.get(run.taskId!)).toMatchObject({
    source: "automation",
    automationRunId: run.id,
  });
  expect(f.turns).toHaveLength(0);
  await expect(f.automations.runNow("nightly")).rejects.toThrow("closing");
  await tasks.close();
});

it.each(["UTC", "Europe/Istanbul", "America/New_York", "Europe/Berlin"])(
  "previews the same instant save schedules in host timezone %s across DST dates",
  async (zone) => {
    const priorZone = process.env.TZ;
    process.env.TZ = zone;
    try {
      for (const instant of [
        "2026-03-08T06:00:00Z",
        "2026-03-29T00:00:00Z",
        "2026-11-01T05:00:00Z",
      ]) {
        const s = await setup(at(instant));
        const input = await s.input({ time: "02:30" });
        const preview = s.automations.preview(input);
        expect(preview.timeZone).toBe(zone);
        expect(preview.nextRunAt).toBe((await s.automations.save(input)).nextRunAt);
      }
    } finally {
      if (priorZone === undefined) delete process.env.TZ;
      else process.env.TZ = priorZone;
    }
  },
);
async function setup(start = at("2026-10-05T08:00:00"), linkedAncestor = false) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "bycoda-automations-test-"));
  let directory = temporaryRoot;
  if (linkedAncestor) {
    const actual = join(temporaryRoot, "actual");
    const alias = join(temporaryRoot, "alias");
    mkdirSync(join(actual, "project"), { recursive: true });
    symlinkSync(actual, alias, process.platform === "win32" ? "junction" : "dir");
    directory = join(alias, "project");
  }
  const store = new HostStore(join(directory, "host.db"));
  const project = await store.addProject(directory, "Test");
  createHostModelRoutingService({
    store,
    catalog: async () => ({ models: {} }),
    readLimits: async () => {
      throw new Error("Unexpected quota read");
    },
    command: async () => "unused",
  });
  const turns: Array<{
    input: SendTurnInput;
    finish: () => void;
    fail: (error: Error) => void;
  }> = [];
  const provider: HostProvider = {
    send: vi.fn(
      (input) =>
        new Promise<void>((resolve, reject) => {
          turns.push({ input, finish: resolve, fail: reject });
        }),
    ),
    cancel: vi.fn(async () => {
      turns.at(-1)?.finish();
    }),
    stop: vi.fn(async () => {
      turns.at(-1)?.finish();
    }),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  const engine = new HostEngine(store, { claude: provider });
  // Legacy per-file checkpoints are independent of this fixture. Managed runs
  // below attach real retained turn-history capture through writerWorkspaces.
  vi.spyOn(engine.checkpoints, "begin").mockResolvedValue();
  vi.spyOn(engine.checkpoints, "finish").mockResolvedValue();
  const clock = { now: start };
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: directory, windowsHide: true, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.test");
  writeFileSync(join(directory, "file.txt"), "base");
  git("add", "file.txt");
  git("commit", "-q", "-m", "initial");
  const workspaces = writerWorkspaces(directory, async (id) => (await store.project(id)).cwd);
  await workspaces.attachEngine(engine);
  const delivery = { review: vi.fn(), merge: vi.fn(), publish: vi.fn(), recover: vi.fn() };
  const managed = {
    ...workspaces,
    registry: { ...workspaces.registry, findOperation: vi.fn(async () => null) },
    delivery,
  } as unknown as TaskWorkspaceServices;
  const tasks = new HostTasks(store, engine, () => clock.now, undefined, managed);
  const automations = new HostAutomations(store, engine, () => clock.now, workspaces);
  automations.bindTasks(tasks);
  const tickAll = async () => {
    await automations.tick();
    for (const run of await automations.runs("nightly")) {
      if (!run.taskId || run.status !== "pending") continue;
      const task = await tasks.get(run.taskId);
      if (task?.status === "todo") await tasks.startTask(task.id);
    }
    await tasks.tick();
    await tasks.idle();
    await automations.tick();
  };
  const runAndSchedule = async (id: string) => {
    const pending = await automations.runNow(id);
    if (!pending.taskId) return pending;
    await tasks.startTask(pending.taskId);
    await tasks.tick();
    await tasks.idle();
    await automations.tick();
    return (await automations.runs(id)).find((run) => run.id === pending.id)!;
  };
  cleanups.push(async () => {
    for (const turn of turns) turn.finish();
    await automations.close();
    await tasks.close();
    await engine.close();
    await store.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  });
  const input = (overrides: Record<string, unknown> = {}) => ({
    id: "nightly",
    name: "Nightly audit",
    prompt: "Review the repository",
    projectId: project.id,
    harness: "claude",
    model: "claude:test",
    modelSettings: {},
    runtimeMode: "auto",
    isolate: true,
    scheduleKind: "daily",
    minute: 0,
    time: "09:00",
    dayOfWeek: 1,
    maxRunMinutes: 0,
    maxRunsPerDay: 0,
    enabled: true,
    ...overrides,
  });
  const settled = async (sessionId: string) => {
    await vi.waitFor(async () => expect((await store.session(sessionId)).status).toBe("idle"), {
      timeout: 20000,
    });
    const task = (await tasks.list()).find((entry) => entry.sessionId === sessionId);
    if (!task?.runId) throw new Error("Missing exact Task run receipt");
    await engine.waitForRun(sessionId, task.runId);
  };
  const approve = async (id: string) => {
    const task = (await tasks.get(id))!;
    const workspace = workspaces.rows.get(task.workspaceId!)!;
    const source = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: task.worktreeCwd!,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
    const target = canonicalWorkspacePathSync(
      task.deliveryCwd ?? (await store.project(task.projectId)).cwd,
    );
    const previousTargetHead = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: target,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
    delivery.review.mockResolvedValueOnce({
      action: "merge",
      workspaceId: workspace.id,
      expectedRevision: workspace.revision,
      token: "fixture-owner-plan",
      expiresAt: clock.now + 60_000,
      sourceBranchRef: workspace.branchRef,
      sourceHead: source,
      targetBranchRef: workspace.targetBranchRef,
      targetDirectory: target,
      targetHead: previousTargetHead,
      targetStatusFingerprint: "fixture-clean-target",
      commits: [],
      changedPaths: [],
      overlappingPaths: [],
      checks: [],
      visualEvidence: [],
      blockers: [],
    } satisfies BranchDeliveryPlan);
    const plan = await tasks.reviewDelivery(id);
    delivery.merge.mockImplementationOnce(async () => {
      execFileSync("git", ["merge", "--no-ff", "--no-edit", source], {
        cwd: target,
        windowsHide: true,
      });
      const targetHead = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: target,
        encoding: "utf8",
        windowsHide: true,
      }).trim();
      workspaces.rows.set(workspace.id, {
        ...workspace,
        state: "merged",
        revision: workspace.revision + 1,
        deliveredCommit: targetHead,
      });
      return {
        operationId: `approve-${id}`,
        workspaceId: workspace.id,
        sourceHead: source,
        previousTargetHead,
        targetHead,
        workspaceRevision: workspace.revision + 1,
      } satisfies BranchMergeReceipt;
    });
    await tasks.mergeDelivery(
      id,
      {
        workspaceId: workspace.id,
        expectedRevision: workspace.revision,
        idempotencyKey: `approve-${id}`,
        planToken: plan.token,
      },
      { ownerId: "test-owner", authorizationId: "test-transport-proof" },
    );
    await automations.tick();
  };
  return {
    store,
    engine,
    provider,
    turns,
    clock,
    automations,
    tasks,
    tickAll,
    runAndSchedule,
    approve,
    input,
    settled,
    workspaces,
    directory,
  };
}
describe("host automations", () => {
  it("defaults writing runs to the current checkout without managed admission", async () => {
    const f = await setup();
    await f.automations.save(f.input({ isolate: undefined }));
    const run = await f.runAndSchedule("nightly");
    await vi.waitFor(() => expect(f.turns).toHaveLength(1), { timeout: 5000 });
    expect(run.status).toBe("running");
    expect(f.turns[0].input.cwd).toBe(f.directory);
    expect(f.turns[0].input.text).toContain("Leave changes uncommitted");
    expect(f.workspaces.prepare).not.toHaveBeenCalled();
  });
  it("inherits a project worktree policy when no run choice is supplied", async () => {
    const f = await setup();
    const { createWorkspacePolicyResolver } = await import("../workspaces/workspace-policy");
    const policy = createWorkspacePolicyResolver(f.store);
    const projectId = String(f.input().projectId);
    await policy.update(
      {
        projectId,
        environmentId: f.workspaces.environmentId,
        policy: { defaultMode: "worktree" },
        expectedRevision: 0,
        idempotencyKey: "automation-worktree",
      },
      { ownerId: "test", authorizationId: "test" },
    );
    f.workspaces.policy = policy;
    await f.automations.save(f.input({ isolate: undefined }));
    const run = await f.runAndSchedule("nightly");
    await vi.waitFor(() => expect(f.turns).toHaveLength(1), { timeout: 20000 });
    expect(run.status).toBe("running");
    expect(f.workspaces.prepare).toHaveBeenCalledOnce();
    expect(f.turns[0].input.cwd).toBe([...f.workspaces.rows.values()][0].path);
  });
  it("dispatches and finalizes a managed run beneath an aliased ancestor", async () => {
    const f = await setup(undefined, true);
    await f.automations.save(f.input());
    const run = await f.runAndSchedule("nightly");
    await vi.waitFor(() => expect(f.turns).toHaveLength(1), { timeout: 20000 });
    expect(f.turns[0].input.cwd).toBe([...f.workspaces.rows.values()][0].path);
    f.turns[0].finish();
    await f.settled(run.sessionId!);
    await f.tickAll();
    await f.approve(run.taskId!);
    expect((await f.automations.runs("nightly"))[0].status).toBe("succeeded");
  });

  it("fails closed when managed workspace support is unavailable or creation fails", async () => {
    const f = await setup();
    await f.automations.save(f.input());
    const legacy = new HostAutomations(f.store, f.engine, () => f.clock.now);
    expect(await legacy.runNow("nightly")).toMatchObject({
      status: "failed",
      error: "Canonical Task service is unavailable.",
    });
    f.workspaces.prepare.mockRejectedValueOnce(new Error("No safe committed base"));
    expect(await f.runAndSchedule("nightly")).toMatchObject({
      status: "failed",
      error: expect.stringContaining("No safe committed base"),
    });
    expect(f.turns).toHaveLength(0);
    await legacy.close();
  });
  it("preserves an automation's dirty source and refuses finished delivery", async () => {
    const f = await setup();
    await f.automations.save(f.input());
    const run = await f.runAndSchedule("nightly");
    await vi.waitFor(() => expect(f.turns).toHaveLength(1), { timeout: 20000 });
    const workspace = [...f.workspaces.rows.values()][0];
    expect(f.turns[0].input.cwd).toBe(workspace.path);
    expect(f.workspaces.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: { kind: "task", id: run.taskId },
        choice: { defaultMode: "worktree" },
      }),
    );
    writeFileSync(join(workspace.path, "unexpected.txt"), "retained source");
    f.turns[0].finish();
    await f.settled(run.sessionId!);
    await f.tickAll();
    const task = await f.tasks.get(run.taskId!);
    expect(task).toMatchObject({
      status: "blocked",
      error: expect.stringContaining(
        "Finalization requires review: uncommitted task changes remain.",
      ),
    });
    expect(
      (await f.automations.runs("nightly")).find((entry) => entry.id === run.id),
    ).toMatchObject({
      status: "failed",
      error: task!.error,
    });
    expect(readFileSync(join(workspace.path, "unexpected.txt"), "utf8")).toBe("retained source");
    expect(f.workspaces.finish).not.toHaveBeenCalled();
    expect(f.workspaces.stop).toHaveBeenCalled();
  });
  it("accepts only one concurrent edit of the same configuration", async () => {
    const f = await setup();
    const opening = await f.automations.save(f.input({ enabled: false }));
    const results = await Promise.allSettled([
      f.automations.save({ ...opening, name: "First", expectedConfiguration: opening }),
      f.automations.save({ ...opening, name: "Second", expectedConfiguration: opening }),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
  });
  it("reserves an automation while Task admission is pending", async () => {
    const f = await setup();
    const tasks = f.tasks;
    await tasks.ready;
    await f.automations.save(f.input());
    const entered = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    Object.defineProperty(tasks, "ready", {
      get: () => {
        entered.resolve();
        return released.promise;
      },
    });
    const first = f.automations.runNow("nightly");
    try {
      await entered.promise;
      const second = await f.automations.runNow("nightly");
      expect(second).toMatchObject({ status: "skipped", error: PREVIOUS_RUN_SKIP });
    } finally {
      released.resolve();
    }
    const run = await first;
    expect(run).toMatchObject({ status: "pending", taskId: expect.any(String) });
    expect(f.turns).toHaveLength(0);
    await tasks.close();
  });
  it("rejects stale configuration edits and toggles while preserving newer automation prompts", async () => {
    const { automations, input } = await setup();
    const opening = await automations.save(input({ enabled: false }));
    const newer = await automations.save({
      ...opening,
      prompt: "Newer prompt",
      expectedConfiguration: opening,
    });
    await expect(
      (async () =>
        await automations.save({ ...opening, name: "My name", expectedConfiguration: opening }))(),
    ).rejects.toThrow("Configuration changed in another client");
    await expect(
      (async () =>
        await automations.save({ ...opening, enabled: true, expectedConfiguration: opening }))(),
    ).rejects.toThrow("Configuration changed in another client");
    expect((await automations.list())[0]).toEqual(newer);
    expect(
      await automations.save({ ...newer, name: "Reconciled", expectedConfiguration: newer }),
    ).toMatchObject({ prompt: "Newer prompt", name: "Reconciled", enabled: false });
  });
  it("keeps an active automation tracked until its session finishes", async () => {
    const { automations, input, turns, settled, runAndSchedule, tickAll, approve } = await setup();
    await automations.save(input());
    const run = await runAndSchedule("nightly");
    await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 20000 });
    await expect((async () => await automations.delete("nightly"))()).rejects.toThrow(
      "still running",
    );
    expect(await automations.list()).toHaveLength(1);
    turns[0].finish();
    await settled(run.sessionId!);
    await tickAll();
    await approve(run.taskId!);
    expect((await automations.runs("nightly"))[0].status).toBe("succeeded");
    await automations.delete("nightly");
    expect(await automations.list()).toEqual([]);
  });
  it("schedules a saved automation for its next occurrence", async () => {
    const { automations, input } = await setup();
    const saved = await automations.save(input());
    expect(saved.nextRunAt).toBe(at("2026-10-05T09:00:00"));
    expect(await automations.list()).toEqual([saved]);
  });
  it("restarts continuous work only after completion and its minimum gap", async () => {
    const { automations, input, clock, turns, settled, tickAll, approve } = await setup();
    const saved = await automations.save(
      input({ trigger: { kind: "continuous", minimumGapMinutes: 2 } }),
    );
    expect(saved.nextRunAt).toBe(clock.now);
    await tickAll();
    const [first] = await automations.runs("nightly");
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    clock.now += 10 * MINUTE;
    await tickAll();
    expect(await automations.runs("nightly")).toHaveLength(1);
    turns[0].finish();
    await settled(first.sessionId!);
    await tickAll();
    await approve(first.taskId!);
    expect((await automations.list())[0].nextRunAt).toBe(clock.now + 2 * MINUTE);
    clock.now += MINUTE;
    await tickAll();
    expect(await automations.runs("nightly")).toHaveLength(1);
    clock.now += MINUTE;
    await tickAll();
    expect(await automations.runs("nightly")).toHaveLength(2);
  });
  it("rejects a continuous trigger without a positive bounded gap", async () => {
    const { automations, input } = await setup();
    await expect(
      automations.save(input({ trigger: { kind: "continuous", minimumGapMinutes: 0 } })),
    ).rejects.toThrow("Invalid automation minimum gap");
  });
  it("deduplicates event occurrences and rejects changed event identities", async () => {
    const { automations, input } = await setup();
    await automations.save(input({ trigger: { kind: "event", event: "task.finished" } }));
    const event = {
      id: "task:one:revision:4",
      kind: "task.finished" as const,
      projectId: input().projectId,
    };
    await automations.recordEvent(event);
    await automations.recordEvent(event);
    expect(await automations.runs("nightly")).toHaveLength(1);
    await expect(automations.recordEvent({ ...event, kind: "task.blocked" })).rejects.toThrow(
      "Automation event identity changed",
    );
  });
  it("rejects an automation for an unknown project", async () => {
    const { automations, input } = await setup();
    await expect(
      (async () => await automations.save(input({ projectId: "missing" })))(),
    ).rejects.toThrow("Project is not registered on this machine");
  });
  it("starts a due run in a session named after the automation", async () => {
    const { automations, input, clock, store, turns, settled, tickAll, approve } = await setup();
    await automations.save(input());
    await tickAll();
    expect(await automations.runs("nightly")).toEqual([]);
    clock.now = at("2026-10-05T09:00:10");
    await tickAll();
    const [run] = await automations.runs("nightly");
    expect(run).toMatchObject({ status: "running", trigger: "scheduled" });
    expect((await store.session(run.sessionId!)).session.title).toBe("Nightly audit");
    await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 20000 });
    expect(turns[0].input.text).toContain("Review the repository");
    expect((await automations.list())[0].nextRunAt).toBe(at("2026-10-06T09:00:00"));
    turns[0].finish();
    await settled(run.sessionId!);
    clock.now += MINUTE;
    await tickAll();
    await approve(run.taskId!);
    expect((await automations.runs("nightly"))[0]).toMatchObject({
      status: "succeeded",
      completedAt: clock.now,
    });
    expect((await automations.list())[0]).toMatchObject({
      lastRunStatus: "succeeded",
      lastSessionId: run.sessionId,
    });
  });
  it("records a failed turn with the agent error", async () => {
    const { automations, input, clock, turns, settled, runAndSchedule, tickAll } = await setup();
    await automations.save(input());
    const run = await runAndSchedule("nightly");
    await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 20000 });
    turns[0].fail(new Error("Not signed in"));
    await settled(run.sessionId!);
    clock.now += MINUTE;
    await tickAll();
    expect((await automations.runs("nightly"))[0]).toMatchObject({
      status: "failed",
      error: "Not signed in",
    });
  });
  it("stops a run that passes its time limit", async () => {
    const clock = { now: at("2026-10-05T08:00:00") };
    // Work budget and quota services capture their clock during construction.
    // Install spies first so every observer shares the admission timeline.
    const wall = vi.spyOn(Date, "now").mockImplementation(() => clock.now);
    const monotonic = vi.spyOn(performance, "now").mockImplementation(() => clock.now);
    try {
      const f = await setup(clock.now);
      const { automations, input, provider, turns, settled, runAndSchedule, tickAll } = f;
      await automations.save(input({ maxRunMinutes: 30 }));
      const run = await runAndSchedule("nightly");
      await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 20000 });
      for (let minute = 0; minute < 29; minute++) {
        clock.now += MINUTE;
        f.clock.now = clock.now;
        await tickAll();
      }
      expect(provider.cancel).not.toHaveBeenCalled();
      clock.now += MINUTE;
      f.clock.now = clock.now;
      await tickAll();
      expect(provider.cancel).toHaveBeenCalledTimes(1);
      await settled(run.sessionId!);
      clock.now += MINUTE;
      f.clock.now = clock.now;
      await tickAll();
      expect((await automations.runs("nightly"))[0]).toMatchObject({
        status: "failed",
        error:
          "Run budget: Task Nightly audit: The cumulative task runtime allowance is exhausted. Completed work and partial findings are retained; owner action is required.",
      });
    } finally {
      wall.mockRestore();
      monotonic.mockRestore();
    }
  });
  it("does not cancel a run after an unobserved wall-clock gap", async () => {
    const { automations, input, clock, provider, turns, runAndSchedule, tickAll } = await setup();
    let elapsed = 0;
    const wall = vi.spyOn(Date, "now").mockImplementation(() => clock.now);
    const monotonic = vi.spyOn(performance, "now").mockImplementation(() => elapsed);
    try {
      await automations.save(input({ maxRunMinutes: 30 }));
      const run = await runAndSchedule("nightly");
      await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 20000 });
      clock.now += 30 * MINUTE;
      await tickAll();
      expect(provider.cancel).not.toHaveBeenCalled();
      // A later matching interval resumes measurement without retroactively
      // charging the gap as thirty minutes of confirmed provider work.
      clock.now += MINUTE;
      elapsed += MINUTE;
      await tickAll();
      expect(provider.cancel).not.toHaveBeenCalled();
      expect((await automations.runs("nightly"))[0]).toMatchObject({
        id: run.id,
        status: "running",
      });
    } finally {
      wall.mockRestore();
      monotonic.mockRestore();
    }
  });
  it("skips a due run while the previous one is still going", async () => {
    const { automations, input, clock, turns, tickAll } = await setup();
    await automations.save(input({ scheduleKind: "hourly" }));
    clock.now = at("2026-10-05T09:00:10");
    await tickAll();
    await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 20000 });
    clock.now = at("2026-10-05T10:00:10");
    await tickAll();
    const [latest, first] = await automations.runs("nightly");
    expect(first.status).toBe("running");
    expect(latest).toMatchObject({
      status: "skipped",
      error: PREVIOUS_RUN_SKIP,
    });
    turns[0].finish();
  });
  it("skips scheduled runs past the daily limit but not manual ones", async () => {
    const { automations, input, clock, turns, settled, runAndSchedule, tickAll, approve } =
      await setup();
    await automations.save(input({ scheduleKind: "hourly", maxRunsPerDay: 1 }));
    clock.now = at("2026-10-05T09:00:10");
    await tickAll();
    await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 20000 });
    turns[0].finish();
    const completed = (await automations.runs("nightly"))[0];
    await settled(completed.sessionId!);
    await tickAll();
    await approve(completed.taskId!);
    clock.now = at("2026-10-05T10:00:10");
    await tickAll();
    expect((await automations.runs("nightly"))[0]).toMatchObject({
      status: "skipped",
      error: "Skipped: reached the limit of 1 run per day.",
    });
    const manual = await runAndSchedule("nightly");
    expect(manual.status).toBe("running");
    await vi.waitFor(() => expect(turns).toHaveLength(2), { timeout: 20000 });
    turns[1].finish();
  });
  it("skips a run missed while the machine was off and reschedules", async () => {
    const { automations, input, clock, provider } = await setup();
    await automations.save(input());
    clock.now = at("2026-10-07T12:00:00");
    await automations.tick();
    expect(await automations.runs("nightly")).toMatchObject([
      { status: "skipped", error: MISSED_RUN_SKIP },
    ]);
    expect(provider.send).not.toHaveBeenCalled();
    expect((await automations.list())[0].nextRunAt).toBe(at("2026-10-08T09:00:00"));
  });
  it("does not run a disabled automation and forgets a deleted one", async () => {
    const { automations, input, clock } = await setup();
    await automations.save(input({ enabled: false }));
    clock.now = at("2026-10-05T09:00:10");
    await automations.tick();
    expect(await automations.runs("nightly")).toEqual([]);
    await automations.delete("nightly");
    expect(await automations.list()).toEqual([]);
    await expect((async () => await automations.runNow("nightly"))()).rejects.toThrow(
      "Automation not found.",
    );
  });
  it("records a run as failed when the host restarted during it", async () => {
    const { automations, input, clock, store, turns, runAndSchedule, tickAll } = await setup();
    await automations.save(input());
    const run = await runAndSchedule("nightly");
    await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 20000 });
    const session = await store.session(run.sessionId!);
    await store.save(
      { ...session, revision: session.revision + 1, status: "interrupted" },
      { type: "interrupted" },
    );
    clock.now += MINUTE;
    await tickAll();
    expect((await automations.runs("nightly"))[0]).toMatchObject({
      status: "failed",
      error: "The host stopped during this run.",
    });
    turns[0].finish();
  });
  it("mirrors whether a running session is waiting on the user", async () => {
    const { automations, input, clock, store, turns, settled, runAndSchedule, tickAll, approve } =
      await setup();
    await automations.save(input());
    const run = await runAndSchedule("nightly");
    await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 20000 });
    const ask = async (pendingQuestion?: { requestId: number; questions: [] }) => {
      const session = await store.session(run.sessionId!);
      await store.save(
        {
          ...session,
          revision: session.revision + 1,
          session: { ...session.session, pendingQuestion },
        },
        { type: "question" },
      );
      clock.now += MINUTE;
      await tickAll();
    };
    await ask({ requestId: 1, questions: [] });
    expect((await automations.runs("nightly"))[0]).toMatchObject({
      status: "running",
      needsInput: true,
    });
    expect((await automations.list())[0].needsInput).toBe(true);
    expect((await automations.runNow("nightly")).status).toBe("skipped");
    await tickAll();
    expect((await automations.list())[0].needsInput).toBe(true);
    await ask(undefined);
    expect(
      (await automations.runs("nightly")).find((entry) => entry.id === run.id)?.needsInput,
    ).toBeUndefined();
    expect((await automations.list())[0].needsInput).toBeUndefined();
    await ask({ requestId: 2, questions: [] });
    turns[0].finish();
    await settled(run.sessionId!);
    clock.now += MINUTE;
    await tickAll();
    expect((await automations.runs("nightly")).find((entry) => entry.id === run.id)).toMatchObject({
      status: "running",
      needsInput: true,
    });
    expect((await automations.list())[0].needsInput).toBe(true);
    await approve(run.taskId!);
    expect((await automations.runs("nightly")).find((entry) => entry.id === run.id)).toMatchObject({
      status: "succeeded",
    });
    expect(
      (await automations.runs("nightly")).find((entry) => entry.id === run.id)?.needsInput,
    ).toBeUndefined();
    expect((await automations.list())[0].needsInput).toBeUndefined();
  });
});
it("cancels an owned queued Task without dispatching it later", async () => {
  const f = await setup();
  await f.automations.save(f.input());
  const pending = await f.automations.runNow("nightly");
  expect(pending.status).toBe("pending");
  expect(pending.taskId).toBeTruthy();
  expect((await f.tasks.get(pending.taskId!))?.source).toBe("automation");
  expect(f.turns).toHaveLength(0);
  const stopped = await f.automations.stopRun("nightly", pending.id);
  expect(stopped.run.status).toBe("cancelled");
  expect((await f.tasks.get(pending.taskId!))?.status).not.toBe("queued");
  await f.tasks.tick();
  await f.tasks.idle();
  expect(f.turns).toHaveLength(0);
});

it("retains active runs across overlapping history pruning and remains stoppable", async () => {
  const { automations, input, turns, settled, store, engine, runAndSchedule, tickAll } =
    await setup();
  await automations.save(input());
  const run = await runAndSchedule("nightly");
  await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 20000 });
  for (let i = 0; i < 110; i++)
    expect((await automations.runNow("nightly")).status).toBe("skipped");
  expect((await automations.runs("nightly")).find((entry) => entry.id === run.id)?.status).toBe(
    "running",
  );
  await automations.stopRun("nightly", run.id);
  expect(
    (await bindSessionWork(store, engine).work.list()).find((item) => item.source.id === run.taskId)
      ?.stopRequested,
  ).toBe(true);
  await settled(run.sessionId!);
  await tickAll();
  expect((await automations.runs("nightly")).find((entry) => entry.id === run.id)?.status).not.toBe(
    "running",
  );
});
it("retains same-day usage above the history limit and resets allowance the next day", async () => {
  const { automations, input, store, clock, turns, settled, runAndSchedule, tickAll, approve } =
    await setup();
  await automations.save(input({ maxRunsPerDay: 101 }));
  const run = await runAndSchedule("nightly");
  await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 20000 });
  const insert = store.db.prepare("INSERT INTO automation_runs VALUES (?, ?, ?, ?)");
  for (let i = 0; i < 100; i++) {
    const row = {
      id: `completed-${i}`,
      automationId: "nightly",
      trigger: "manual",
      status: "succeeded",
      createdAt: clock.now - 1000 + i,
      startedAt: clock.now - 1000 + i,
    };
    await insert.run(row.id, "nightly", row.createdAt, JSON.stringify(row));
  }
  turns[0].finish();
  await settled(run.sessionId!);
  await tickAll();
  await approve(run.taskId!);
  clock.now = at("2026-10-05T09:00:10");
  await tickAll();
  expect((await automations.runs("nightly"))[0].status).toBe("skipped");
  clock.now = at("2026-10-06T09:00:10");
  await tickAll();
  expect((await automations.runs("nightly"))[0].status).toBe("running");
});

it("selects only owned recovery candidates without reading full run history", async () => {
  const f = await setup();
  await f.automations.save(f.input({ enabled: false }));
  const seeds = [
    { id: "settled", status: "succeeded" },
    { id: "running", status: "running" },
    { id: "cleanup", status: "failed", cleanupPending: true },
    { id: "numeric-cleanup", status: "failed", cleanupPending: 1 },
    { id: "text-cleanup", status: "failed", cleanupPending: "yes" },
    { id: "managed", status: "pending", workspaceId: "workspace-nonnumeric" },
    { id: "zero-workspace", status: "pending", workspaceId: 0 },
    { id: "array-workspace", status: "pending", workspaceId: [] },
    { id: "unowned", status: "pending" },
    { id: "work-owned", status: "pending", workPending: true },
    { id: "numeric-work", status: "pending", workPending: 1 },
    { id: "text-work", status: "pending", workPending: "true" },
    { id: "clean-failure", status: "failed" },
  ];
  for (const seed of seeds) {
    const run = {
      ...seed,
      automationId: "nightly",
      createdAt: f.clock.now,
      trigger: "manual",
      scheduledFor: f.clock.now,
    };
    await f.store.db
      .prepare("INSERT INTO automation_runs VALUES (?, ?, ?, ?)")
      .run(run.id, "nightly", run.createdAt, JSON.stringify(run));
  }
  const history = vi
    .spyOn(f.automations, "runs")
    .mockRejectedValue(new Error("Full history must not be read"));
  const queries = f.automations as unknown as { activeRuns(): Promise<Array<{ id: string }>> };
  expect((await queries.activeRuns()).map((run) => run.id).sort()).toEqual([
    "array-workspace",
    "cleanup",
    "managed",
    "running",
    "work-owned",
  ]);
  expect(history).not.toHaveBeenCalled();
  history.mockRestore();
  expect(await f.automations.runs("nightly")).toHaveLength(seeds.length);
});

it("keeps legacy nonempty cleanup metadata as a deletion hold instead of SQLite numeric false", async () => {
  const f = await setup();
  await f.automations.save(f.input({ enabled: false }));
  await f.store.db.prepare("INSERT INTO automation_runs VALUES (?,?,?,?)").run(
    "cleanup-text",
    "nightly",
    f.clock.now,
    JSON.stringify({
      id: "cleanup-text",
      automationId: "nightly",
      status: "failed",
      cleanupPending: "unknown",
    }),
  );
  await expect(f.automations.delete("nightly")).rejects.toThrow(/cleanup/i);
  expect(await f.automations.runs("nightly")).toHaveLength(1);
});

it("counts local-day starts without materializing history or counting skipped/self runs", async () => {
  const f = await setup();
  const automation = await f.automations.save(f.input({ maxRunsPerDay: 2, enabled: false }));
  const midnight = new Date(f.clock.now);
  midnight.setHours(0, 0, 0, 0);
  for (const [id, status, startedAt] of [
    ["before", "succeeded", midnight.getTime() - 1],
    ["boundary", "failed", midnight.getTime()],
    ["skipped", "skipped", f.clock.now],
    ["self", "running", f.clock.now],
  ] as const) {
    await f.store.db
      .prepare("INSERT INTO automation_runs VALUES (?, ?, ?, ?)")
      .run(id, "nightly", startedAt, JSON.stringify({ id, status, startedAt }));
  }
  const queries = f.automations as unknown as {
    dailyLimitSkip(input: typeof automation, runId: string, now: number): Promise<string | null>;
  };
  expect(await queries.dailyLimitSkip(automation, "self", f.clock.now)).toBeNull();
  await f.store.db
    .prepare("INSERT INTO automation_runs VALUES (?, ?, ?, ?)")
    .run(
      "second",
      "nightly",
      f.clock.now,
      JSON.stringify({ id: "second", status: "succeeded", startedAt: f.clock.now }),
    );
  expect(await queries.dailyLimitSkip(automation, "self", f.clock.now)).toBe(
    "Skipped: reached the limit of 2 runs per day.",
  );
});

it("resolves automation routing before creating its session and freezes target and run limit", async () => {
  const f = await setup();
  const routing = hostModelRoutingService(f.store);
  vi.spyOn(routing, "get").mockResolvedValue({
    entries: [],
    pools: [],
    roles: {},
    delegation: { global: {}, providers: {}, accounts: {} },
    version: 0,
    updatedAt: 0,
    defaultMaxRunMinutes: 13,
  });
  const execution = {
    harness: "claude" as const,
    model: "claude:routed",
    modelSettings: { effort: "high", crossAdvisor: "advisor" },
  };
  const resolve = vi.spyOn(routing, "resolve").mockResolvedValue({
    ok: true,
    target: execution,
    source: { kind: "order", entryId: "first" },
    skipped: [],
  });
  await f.automations.save(f.input({ modelChoice: { kind: "default" } }));
  const original = f.engine.command.bind(f.engine);
  vi.spyOn(f.engine, "command").mockImplementation(async (command) => {
    if ((command as { type: string }).type === "create")
      expect((await f.automations.runs("nightly"))[0]).toMatchObject({
        execution,
        maxRunMinutes: 13,
        status: "pending",
      });
    return original(command);
  });
  const run = await f.runAndSchedule("nightly");
  expect(run).toMatchObject({ status: "running", execution, maxRunMinutes: 13 });
  expect(resolve).toHaveBeenCalledWith(
    expect.objectContaining({ role: "automation", choice: { kind: "default" } }),
  );
  await vi.waitFor(() =>
    expect(f.turns[0]?.input).toMatchObject({
      model: "claude:routed",
      modelSettings: execution.modelSettings,
    }),
  );
});

it("skips exhausted routing without creating a session and retries at the next occurrence", async () => {
  const f = await setup();
  const routing = hostModelRoutingService(f.store);
  const resolve = vi.spyOn(routing, "resolve").mockResolvedValue({
    ok: false,
    reason: "noEligibleEntry",
    skipped: [{ entryId: "first", reason: "belowLimit" }],
    nextResetAt: f.clock.now + 60_000,
  });
  await f.automations.save(f.input({ modelChoice: { kind: "order" } }));
  const command = vi.spyOn(f.engine, "command");
  const skipped = await f.automations.runNow("nightly");
  expect(skipped).toMatchObject({
    status: "skipped",
    error: expect.stringContaining("first: belowLimit"),
  });
  expect(command).not.toHaveBeenCalled();
  resolve.mockResolvedValue({ ok: false, reason: "notConfigured", skipped: [] });
  const retried = await f.runAndSchedule("nightly");
  expect(retried).toMatchObject({ status: "running", execution: { model: "claude:test" } });
});
