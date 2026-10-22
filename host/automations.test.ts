import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import type { HostProvider } from "./providers";
import { HostEngine } from "./engine";
import { HostStore } from "./store";
import { HostAutomations, MISSED_RUN_SKIP, PREVIOUS_RUN_SKIP } from "./automations";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const at = (value: string) => new Date(value).getTime();
const MINUTE = 60_000;

it.each(["UTC", "Europe/Istanbul", "America/New_York", "Europe/Berlin"])(
  "previews the same instant save schedules in host timezone %s across DST dates",
  (zone) => {
    const priorZone = process.env.TZ;
    process.env.TZ = zone;
    try {
      for (const instant of [
        "2026-03-08T06:00:00Z",
        "2026-03-29T00:00:00Z",
        "2026-11-01T05:00:00Z",
      ]) {
        const s = setup(at(instant));
        const input = s.input({ time: "02:30" });
        const preview = s.automations.preview(input);
        expect(preview.timeZone).toBe(zone);
        expect(preview.nextRunAt).toBe(s.automations.save(input).nextRunAt);
      }
    } finally {
      if (priorZone === undefined) delete process.env.TZ;
      else process.env.TZ = priorZone;
    }
  },
);

function setup(start = at("2026-10-05T08:00:00")) {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-automations-test-"));
  const store = new HostStore(join(directory, "host.db"));
  const project = store.addProject(directory, "Test");
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
  const clock = { now: start };
  const automations = new HostAutomations(store, engine, () => clock.now);
  cleanups.push(async () => {
    await engine.close();
    store.close();
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
    vi.waitFor(() => expect(store.session(sessionId).status).toBe("idle"));
  return { store, engine, provider, turns, clock, automations, input, settled };
}

describe("host automations", () => {
  it("rejects stale configuration edits and toggles while preserving newer automation prompts", () => {
    const { automations, input } = setup();
    const opening = automations.save(input({ enabled: false }));
    const newer = automations.save({
      ...opening,
      prompt: "Newer prompt",
      expectedConfiguration: opening,
    });
    expect(() =>
      automations.save({ ...opening, name: "My name", expectedConfiguration: opening }),
    ).toThrow("Configuration changed in another client");
    expect(() =>
      automations.save({ ...opening, enabled: true, expectedConfiguration: opening }),
    ).toThrow("Configuration changed in another client");
    expect(automations.list()[0]).toEqual(newer);
    expect(
      automations.save({ ...newer, name: "Reconciled", expectedConfiguration: newer }),
    ).toMatchObject({ prompt: "Newer prompt", name: "Reconciled", enabled: false });
  });
  it("keeps an active automation tracked until its session finishes", async () => {
    const { automations, input, turns, settled } = setup();
    automations.save(input());
    const run = automations.runNow("nightly");
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(() => automations.delete("nightly")).toThrow("still running");
    expect(automations.list()).toHaveLength(1);
    turns[0].finish();
    await settled(run.sessionId!);
    automations.tick();
    expect(automations.runs("nightly")[0].status).toBe("succeeded");
    automations.delete("nightly");
    expect(automations.list()).toEqual([]);
  });
  it("schedules a saved automation for its next occurrence", () => {
    const { automations, input } = setup();
    const saved = automations.save(input());
    expect(saved.nextRunAt).toBe(at("2026-10-05T09:00:00"));
    expect(automations.list()).toEqual([saved]);
  });

  it("rejects an automation for an unknown project", () => {
    const { automations, input } = setup();
    expect(() => automations.save(input({ projectId: "missing" }))).toThrow(
      "Project is not registered on this machine",
    );
  });

  it("starts a due run in a session named after the automation", async () => {
    const { automations, input, clock, store, turns, settled } = setup();
    automations.save(input());
    automations.tick();
    expect(automations.runs("nightly")).toEqual([]);

    clock.now = at("2026-10-05T09:00:10");
    automations.tick();
    const [run] = automations.runs("nightly");
    expect(run).toMatchObject({ status: "running", trigger: "scheduled" });
    expect(store.session(run.sessionId!).session.title).toBe("Nightly audit");
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(turns[0].input.text).toBe("Review the repository");
    expect(automations.list()[0].nextRunAt).toBe(at("2026-10-06T09:00:00"));

    turns[0].finish();
    await settled(run.sessionId!);
    clock.now += MINUTE;
    automations.tick();
    expect(automations.runs("nightly")[0]).toMatchObject({
      status: "succeeded",
      completedAt: clock.now,
    });
    expect(automations.list()[0]).toMatchObject({
      lastRunStatus: "succeeded",
      lastSessionId: run.sessionId,
    });
  });

  it("records a failed turn with the agent error", async () => {
    const { automations, input, clock, turns, settled } = setup();
    automations.save(input());
    const run = automations.runNow("nightly");
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    turns[0].fail(new Error("Not signed in"));
    await settled(run.sessionId!);
    clock.now += MINUTE;
    automations.tick();
    expect(automations.runs("nightly")[0]).toMatchObject({
      status: "failed",
      error: "Not signed in",
    });
  });

  it("stops a run that passes its time limit", async () => {
    const { automations, input, clock, provider, turns, settled } = setup();
    automations.save(input({ maxRunMinutes: 30 }));
    const run = automations.runNow("nightly");
    await vi.waitFor(() => expect(turns).toHaveLength(1));

    clock.now += 29 * MINUTE;
    automations.tick();
    expect(provider.cancel).not.toHaveBeenCalled();

    clock.now += MINUTE;
    automations.tick();
    expect(provider.cancel).toHaveBeenCalledTimes(1);
    await settled(run.sessionId!);
    clock.now += MINUTE;
    automations.tick();
    expect(automations.runs("nightly")[0]).toMatchObject({
      status: "failed",
      error: "Stopped: reached the 30-minute time limit.",
    });
  });

  it("skips a due run while the previous one is still going", async () => {
    const { automations, input, clock, turns } = setup();
    automations.save(input({ scheduleKind: "hourly" }));
    clock.now = at("2026-10-05T09:00:10");
    automations.tick();
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    clock.now = at("2026-10-05T10:00:10");
    automations.tick();
    const [latest, first] = automations.runs("nightly");
    expect(first.status).toBe("running");
    expect(latest).toMatchObject({
      status: "skipped",
      error: PREVIOUS_RUN_SKIP,
    });
    turns[0].finish();
  });

  it("skips scheduled runs past the daily limit but not manual ones", async () => {
    const { automations, input, clock, turns, settled } = setup();
    automations.save(input({ scheduleKind: "hourly", maxRunsPerDay: 1 }));
    clock.now = at("2026-10-05T09:00:10");
    automations.tick();
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    turns[0].finish();
    await settled(automations.runs("nightly")[0].sessionId!);

    clock.now = at("2026-10-05T10:00:10");
    automations.tick();
    expect(automations.runs("nightly")[0]).toMatchObject({
      status: "skipped",
      error: "Skipped: reached the limit of 1 run per day.",
    });

    const manual = automations.runNow("nightly");
    expect(manual.status).toBe("running");
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    turns[1].finish();
  });

  it("skips a run missed while the machine was off and reschedules", () => {
    const { automations, input, clock, provider } = setup();
    automations.save(input());
    clock.now = at("2026-10-07T12:00:00");
    automations.tick();
    expect(automations.runs("nightly")).toMatchObject([
      { status: "skipped", error: MISSED_RUN_SKIP },
    ]);
    expect(provider.send).not.toHaveBeenCalled();
    expect(automations.list()[0].nextRunAt).toBe(at("2026-10-08T09:00:00"));
  });

  it("does not run a disabled automation and forgets a deleted one", () => {
    const { automations, input, clock } = setup();
    automations.save(input({ enabled: false }));
    clock.now = at("2026-10-05T09:00:10");
    automations.tick();
    expect(automations.runs("nightly")).toEqual([]);
    automations.delete("nightly");
    expect(automations.list()).toEqual([]);
    expect(() => automations.runNow("nightly")).toThrow("Automation not found.");
  });

  it("records a run as failed when the host restarted during it", async () => {
    const { automations, input, clock, store, turns } = setup();
    automations.save(input());
    const run = automations.runNow("nightly");
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    const session = store.session(run.sessionId!);
    store.save(
      { ...session, revision: session.revision + 1, status: "interrupted" },
      { type: "interrupted" },
    );
    clock.now += MINUTE;
    automations.tick();
    expect(automations.runs("nightly")[0]).toMatchObject({
      status: "failed",
      error: "The host stopped during this run.",
    });
    turns[0].finish();
  });

  it("mirrors whether a running session is waiting on the user", async () => {
    const { automations, input, clock, store, turns, settled } = setup();
    automations.save(input());
    const run = automations.runNow("nightly");
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    const ask = (pendingQuestion?: { requestId: number; questions: [] }) => {
      const session = store.session(run.sessionId!);
      store.save(
        {
          ...session,
          revision: session.revision + 1,
          session: { ...session.session, pendingQuestion },
        },
        { type: "question" },
      );
      clock.now += MINUTE;
      automations.tick();
    };
    ask({ requestId: 1, questions: [] });
    expect(automations.runs("nightly")[0]).toMatchObject({
      status: "running",
      needsInput: true,
    });
    expect(automations.list()[0].needsInput).toBe(true);

    expect(automations.runNow("nightly").status).toBe("skipped");
    automations.tick();
    expect(automations.list()[0].needsInput).toBe(true);

    ask(undefined);
    expect(automations.runs("nightly")[0].needsInput).toBeUndefined();
    expect(automations.list()[0].needsInput).toBeUndefined();

    ask({ requestId: 2, questions: [] });
    turns[0].finish();
    await settled(run.sessionId!);
    clock.now += MINUTE;
    automations.tick();
    expect(automations.runs("nightly")[0].status).not.toBe("running");
    expect(automations.runs("nightly")[0].needsInput).toBeUndefined();
    expect(automations.list()[0].needsInput).toBeUndefined();
  });
});

it("retains active runs across overlapping history pruning and remains stoppable", async () => {
  const { automations, input, turns, settled } = setup();
  automations.save(input());
  const run = automations.runNow("nightly");
  await vi.waitFor(() => expect(turns).toHaveLength(1));
  for (let i = 0; i < 110; i++) expect(automations.runNow("nightly").status).toBe("skipped");
  expect(automations.runs("nightly").find((entry) => entry.id === run.id)?.status).toBe("running");
  automations.stopRun("nightly", run.id);
  await settled(run.sessionId!);
  automations.tick();
  expect(automations.runs("nightly").find((entry) => entry.id === run.id)?.status).not.toBe(
    "running",
  );
});

it("retains same-day usage above the history limit and resets allowance the next day", async () => {
  const { automations, input, store, clock, turns, settled } = setup();
  automations.save(input({ maxRunsPerDay: 101 }));
  const run = automations.runNow("nightly");
  await vi.waitFor(() => expect(turns).toHaveLength(1));
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
    insert.run(row.id, "nightly", row.createdAt, JSON.stringify(row));
  }
  turns[0].finish();
  await settled(run.sessionId!);
  automations.tick();
  clock.now = at("2026-10-05T09:00:10");
  automations.tick();
  expect(automations.runs("nightly")[0].status).toBe("skipped");
  clock.now = at("2026-10-06T09:00:10");
  automations.tick();
  expect(automations.runs("nightly")[0].status).toBe("running");
});
