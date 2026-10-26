import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { writerWorkspaces } from "./writer-workspaces.test-support";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import type { HostProvider } from "./providers";
import { HostEngine } from "./engine";
import { HostStore } from "./store";
import { HostAutomations, MISSED_RUN_SKIP, PREVIOUS_RUN_SKIP } from "./automations";
if (process.platform === "win32") vi.setConfig({ testTimeout: 60000 });
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const at = (value: string) => new Date(value).getTime();
const MINUTE = 60000;
it("drains a held manual launch on close and prevents dispatch after preparation", async () => {
  const f = await setup();
  await f.automations.save(f.input());
  const entered = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const original = f.engine.updateSession.bind(f.engine);
  vi.spyOn(f.engine, "updateSession").mockImplementation(async (...args) => {
    const updated = await original(...args);
    entered.resolve();
    await released.promise;
    return updated;
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
  expect(run.status).toBe("skipped");
  expect(f.turns).toHaveLength(0);
  await expect(f.automations.runNow("nightly")).rejects.toThrow("closing");
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
async function setup(start = at("2026-10-05T08:00:00")) {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-automations-test-"));
  const store = new HostStore(join(directory, "host.db"));
  const project = await store.addProject(directory, "Test");
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
  const automations = new HostAutomations(store, engine, () => clock.now, workspaces);
  cleanups.push(async () => {
    for (const turn of turns) turn.finish();
    await engine.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
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
    scheduleKind: "daily",
    minute: 0,
    time: "09:00",
    dayOfWeek: 1,
    maxRunMinutes: 0,
    maxRunsPerDay: 0,
    enabled: true,
    ...overrides,
  });
  const settled = (sessionId: string) =>
    vi.waitFor(async () => expect((await store.session(sessionId)).status).toBe("idle"), {
      timeout: 20000,
    });
  return {
    store,
    engine,
    provider,
    turns,
    clock,
    automations,
    input,
    settled,
    workspaces,
    directory,
  };
}
describe("host automations", () => {
  it("fails closed when managed workspace support is unavailable or creation fails", async () => {
    const f = await setup();
    await f.automations.save(f.input());
    const legacy = new HostAutomations(f.store, f.engine, () => f.clock.now);
    expect(await legacy.runNow("nightly")).toMatchObject({
      status: "failed",
      error: expect.stringContaining("Update the Host"),
    });
    f.workspaces.prepare.mockRejectedValueOnce(new Error("No safe committed base"));
    expect(await f.automations.runNow("nightly")).toMatchObject({
      status: "failed",
      error: "No safe committed base",
    });
    expect(f.turns).toHaveLength(0);
    await legacy.close();
  });
  it("preserves an automation's dirty source and refuses finished delivery", async () => {
    const f = await setup();
    await f.automations.save(f.input());
    const run = await f.automations.runNow("nightly");
    await vi.waitFor(() => expect(f.turns).toHaveLength(1), { timeout: 20000 });
    const workspace = [...f.workspaces.rows.values()][0];
    expect(f.turns[0].input.cwd).toBe(workspace.path);
    expect(f.workspaces.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: { kind: "automationRun", id: run.id },
        choice: { defaultMode: "worktree" },
      }),
    );
    writeFileSync(join(workspace.path, "unexpected.txt"), "retained source");
    f.turns[0].finish();
    await f.settled(run.sessionId!);
    await f.automations.tick();
    expect((await f.automations.runs("nightly"))[0]).toMatchObject({
      status: "failed",
      error: expect.stringContaining("Finalization requires review"),
    });
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
  it("reserves an automation before an awaited manual launch preparation", async () => {
    const f = await setup();
    await f.automations.save(f.input());
    const entered = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    const original = f.engine.updateSession.bind(f.engine);
    vi.spyOn(f.engine, "updateSession").mockImplementation(async (...args) => {
      const updated = await original(...args);
      entered.resolve();
      await released.promise;
      return updated;
    });
    const first = f.automations.runNow("nightly");
    try {
      await entered.promise;
      const second = await f.automations.runNow("nightly");
      expect(second).toMatchObject({ status: "skipped", error: PREVIOUS_RUN_SKIP });
    } finally {
      released.resolve();
    }
    await first;
    await vi.waitFor(() => expect(f.turns).toHaveLength(1), { timeout: 20000 });
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
    const { automations, input, turns, settled } = await setup();
    await automations.save(input());
    const run = await automations.runNow("nightly");
    await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 20000 });
    await expect((async () => await automations.delete("nightly"))()).rejects.toThrow(
      "still running",
    );
    expect(await automations.list()).toHaveLength(1);
    turns[0].finish();
    await settled(run.sessionId!);
    await automations.tick();
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
  it("rejects an automation for an unknown project", async () => {
    const { automations, input } = await setup();
    await expect(
      (async () => await automations.save(input({ projectId: "missing" })))(),
    ).rejects.toThrow("Project is not registered on this machine");
  });
  it("starts a due run in a session named after the automation", async () => {
    const { automations, input, clock, store, turns, settled } = await setup();
    await automations.save(input());
    await automations.tick();
    expect(await automations.runs("nightly")).toEqual([]);
    clock.now = at("2026-10-05T09:00:10");
    await automations.tick();
    const [run] = await automations.runs("nightly");
    expect(run).toMatchObject({ status: "running", trigger: "scheduled" });
    expect((await store.session(run.sessionId!)).session.title).toBe("Nightly audit");
    await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 20000 });
    expect(turns[0].input.text).toContain("Review the repository");
    expect((await automations.list())[0].nextRunAt).toBe(at("2026-10-06T09:00:00"));
    turns[0].finish();
    await settled(run.sessionId!);
    clock.now += MINUTE;
    await automations.tick();
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
    const { automations, input, clock, turns, settled } = await setup();
    await automations.save(input());
    const run = await automations.runNow("nightly");
    await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 20000 });
    turns[0].fail(new Error("Not signed in"));
    await settled(run.sessionId!);
    clock.now += MINUTE;
    await automations.tick();
    expect((await automations.runs("nightly"))[0]).toMatchObject({
      status: "failed",
      error: "Not signed in",
    });
  });
  it("stops a run that passes its time limit", async () => {
    const { automations, input, clock, provider, turns, settled } = await setup();
    await automations.save(input({ maxRunMinutes: 30 }));
    const run = await automations.runNow("nightly");
    await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 20000 });
    clock.now += 29 * MINUTE;
    await automations.tick();
    expect(provider.cancel).not.toHaveBeenCalled();
    clock.now += MINUTE;
    await automations.tick();
    expect(provider.cancel).toHaveBeenCalledTimes(1);
    await settled(run.sessionId!);
    clock.now += MINUTE;
    await automations.tick();
    expect((await automations.runs("nightly"))[0]).toMatchObject({
      status: "failed",
      error: "Stopped: reached the 30-minute time limit.",
    });
  });
  it("skips a due run while the previous one is still going", async () => {
    const { automations, input, clock, turns } = await setup();
    await automations.save(input({ scheduleKind: "hourly" }));
    clock.now = at("2026-10-05T09:00:10");
    await automations.tick();
    await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 20000 });
    clock.now = at("2026-10-05T10:00:10");
    await automations.tick();
    const [latest, first] = await automations.runs("nightly");
    expect(first.status).toBe("running");
    expect(latest).toMatchObject({
      status: "skipped",
      error: PREVIOUS_RUN_SKIP,
    });
    turns[0].finish();
  });
  it("skips scheduled runs past the daily limit but not manual ones", async () => {
    const { automations, input, clock, turns, settled } = await setup();
    await automations.save(input({ scheduleKind: "hourly", maxRunsPerDay: 1 }));
    clock.now = at("2026-10-05T09:00:10");
    await automations.tick();
    await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 20000 });
    turns[0].finish();
    await settled((await automations.runs("nightly"))[0].sessionId!);
    clock.now = at("2026-10-05T10:00:10");
    await automations.tick();
    expect((await automations.runs("nightly"))[0]).toMatchObject({
      status: "skipped",
      error: "Skipped: reached the limit of 1 run per day.",
    });
    const manual = await automations.runNow("nightly");
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
    const { automations, input, clock, store, turns } = await setup();
    await automations.save(input());
    const run = await automations.runNow("nightly");
    await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 20000 });
    const session = await store.session(run.sessionId!);
    await store.save(
      { ...session, revision: session.revision + 1, status: "interrupted" },
      { type: "interrupted" },
    );
    clock.now += MINUTE;
    await automations.tick();
    expect((await automations.runs("nightly"))[0]).toMatchObject({
      status: "failed",
      error: "The host stopped during this run.",
    });
    turns[0].finish();
  });
  it("mirrors whether a running session is waiting on the user", async () => {
    const { automations, input, clock, store, turns, settled } = await setup();
    await automations.save(input());
    const run = await automations.runNow("nightly");
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
      await automations.tick();
    };
    await ask({ requestId: 1, questions: [] });
    expect((await automations.runs("nightly"))[0]).toMatchObject({
      status: "running",
      needsInput: true,
    });
    expect((await automations.list())[0].needsInput).toBe(true);
    expect((await automations.runNow("nightly")).status).toBe("skipped");
    await automations.tick();
    expect((await automations.list())[0].needsInput).toBe(true);
    await ask(undefined);
    expect((await automations.runs("nightly"))[0].needsInput).toBeUndefined();
    expect((await automations.list())[0].needsInput).toBeUndefined();
    await ask({ requestId: 2, questions: [] });
    turns[0].finish();
    await settled(run.sessionId!);
    clock.now += MINUTE;
    await automations.tick();
    expect((await automations.runs("nightly"))[0].status).not.toBe("running");
    expect((await automations.runs("nightly"))[0].needsInput).toBeUndefined();
    expect((await automations.list())[0].needsInput).toBeUndefined();
  });
});
it("retains active runs across overlapping history pruning and remains stoppable", async () => {
  const { automations, input, turns, settled } = await setup();
  await automations.save(input());
  const run = await automations.runNow("nightly");
  await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 20000 });
  for (let i = 0; i < 110; i++)
    expect((await automations.runNow("nightly")).status).toBe("skipped");
  expect((await automations.runs("nightly")).find((entry) => entry.id === run.id)?.status).toBe(
    "running",
  );
  await automations.stopRun("nightly", run.id);
  await settled(run.sessionId!);
  await automations.tick();
  expect((await automations.runs("nightly")).find((entry) => entry.id === run.id)?.status).not.toBe(
    "running",
  );
});
it("retains same-day usage above the history limit and resets allowance the next day", async () => {
  const { automations, input, store, clock, turns, settled } = await setup();
  await automations.save(input({ maxRunsPerDay: 101 }));
  const run = await automations.runNow("nightly");
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
  await automations.tick();
  clock.now = at("2026-10-05T09:00:10");
  await automations.tick();
  expect((await automations.runs("nightly"))[0].status).toBe("skipped");
  clock.now = at("2026-10-06T09:00:10");
  await automations.tick();
  expect((await automations.runs("nightly"))[0].status).toBe("running");
});
