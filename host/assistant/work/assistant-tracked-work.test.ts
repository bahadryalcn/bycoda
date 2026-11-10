import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import { HostAssistant, type AssistantPorts } from "../service";
import { describeVerification, NO_VERIFICATION } from "./assistant-goal-verification";
import { assistantJobNotificationBody } from "./assistant-job-holds";
import { MAX_TRACKED_WORK, TRACKED_TERMINAL_MS } from "./assistant-tracked-work";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
const execution = {
  harness: "codex" as const,
  model: "m",
  modelSettings: {},
  runtimeMode: "supervised" as const,
  maxRunMinutes: 60,
};
async function setup(ports: AssistantPorts = {}, autonomy: "report" | "jobs" | "chief" = "jobs") {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-tracked-"));
  const store = new HostStore(join(dir, "host.db"));
  await store.ready;
  await store.db.exec(
    "CREATE TABLE goals(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE tasks(id TEXT PRIMARY KEY,value TEXT NOT NULL)",
  );
  const service = new HostAssistant(store, {
    listProjects: async () => [{ id: "project", path: dir, name: "Test" }],
    ...ports,
  });
  await service.ready;
  const snap = (await service.request({ op: "snapshot" }, "owner")).snapshot!;
  await service.request(
    {
      op: "profile.update",
      expectedVersion: snap.profile.version,
      patch: {
        name: "Test Name",
        autonomy,
        dailyTokenBudget: 100000,
        setupComplete: true,
        enabled: true,
        execution,
      },
    },
    "owner",
  );
  cleanups.push(async () => {
    await service.close();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const put = (table: "goals" | "tasks", value: { id: string; [key: string]: unknown }) =>
    store.db
      .prepare(`INSERT OR REPLACE INTO ${table}(id,value) VALUES(?,?)`)
      .run(value.id, JSON.stringify(value));
  // The daily briefing depends on the wall clock (after 09:00), not on tracked work.
  const notices = async () =>
    (
      ((await service.request({ op: "snapshot" }, "owner")).snapshot!.notifications ?? []) as {
        kind: string;
        title: string;
        body: string;
        id: string;
      }[]
    ).filter((notice) => notice.kind !== "briefing");
  return { store, service, put, notices };
}
const item = (id: string, kind: "goal" | "task" | "crew" = "goal") => ({
  kind,
  id,
  projectId: "project",
  threadId: "thread",
  title: `Work ${id}`,
});
const goal = (over: Record<string, unknown> = {}) => ({
  id: "g1",
  status: "running",
  projectIds: ["project"],
  taskIds: [],
  ...over,
});
const trackedIds = async (f: Awaited<ReturnType<typeof setup>>) =>
  (
    await f.store.db.prepare("SELECT id FROM assistant_runtime WHERE id LIKE 'tracked:%'").all()
  ).map((row) => String(row.id));

describe("tracked direct work", () => {
  it("notifies once when a tracked goal is done and states recorded verification", async () => {
    const f = await setup();
    await f.service.trackDirectWork(item("g1"));
    await f.put("goals", goal());
    await f.service.tick();
    expect(await f.notices()).toEqual([]);
    await f.put(
      "goals",
      goal({ status: "done", finalReview: true, finalAcceptance: { status: "passed" } }),
    );
    await f.service.tick();
    await f.service.tick();
    const done = (await f.notices()).filter((n) => n.kind === "job.done");
    expect(done).toHaveLength(1);
    expect(done[0].title).toBe("Goal: Work g1");
    expect(done[0].body).toBe("Goal is done. Final review accepted the integrated result.");
  });

  it("notifies a failed tracked task", async () => {
    const f = await setup();
    await f.service.trackDirectWork(item("t1", "task"));
    await f.put("tasks", { id: "t1", status: "blocked", error: "Tests crashed" });
    await f.service.tick();
    expect(await f.notices()).toMatchObject([
      { kind: "job.failed", title: "Task: Work t1", body: "Tests crashed" },
    ]);
  });

  it("reports a finished task with the recorded checks only", async () => {
    const f = await setup();
    await f.service.trackDirectWork(item("t2", "task"));
    await f.put("tasks", {
      id: "t2",
      status: "review",
      verification: {
        command: { exitCode: 0, output: "", timedOut: false },
        review: { verdict: "pass", note: "", sessionId: "s" },
      },
    });
    await f.service.tick();
    expect((await f.notices())[0].body).toBe(
      "Task is done. The verify command passed for 1 task. Independent review passed for 1 task.",
    );
  });

  it("tracks the same work once", async () => {
    const f = await setup();
    await f.service.trackDirectWork(item("g1"));
    await f.service.trackDirectWork(item("g1"));
    expect(await trackedIds(f)).toHaveLength(1);
  });

  it("keeps at most the bound, dropping terminal then oldest items", async () => {
    let now = 1_000_000;
    const f = await setup({ now: () => now });
    for (let i = 0; i < MAX_TRACKED_WORK; i++) {
      now += 1000;
      await f.service.trackDirectWork(item(`g${i}`));
    }
    await f.put("goals", goal({ id: "g5", status: "cancelled" }));
    await f.service.tick();
    now += 1000;
    await f.service.trackDirectWork(item("extra"));
    const ids = await trackedIds(f);
    expect(ids).toHaveLength(MAX_TRACKED_WORK);
    expect(ids).toContain("tracked:goal:extra");
    expect(ids).not.toContain("tracked:goal:g5");
    expect(ids).toContain("tracked:goal:g0");
  });

  it("drops terminal items after seven days", async () => {
    let now = 1_000_000;
    const f = await setup({ now: () => now });
    await f.service.trackDirectWork(item("g1"));
    await f.put("goals", goal({ status: "cancelled" }));
    await f.service.tick();
    expect(await trackedIds(f)).toHaveLength(1);
    now += TRACKED_TERMINAL_MS + 1000;
    await f.service.tick();
    expect(await trackedIds(f)).toHaveLength(0);
  });
});

describe("Jobs-mode stall recovery", () => {
  async function stalledJob(autonomy: "jobs" | "chief" | "report") {
    const now = 10_000_000;
    const manageSession = vi.fn(async (_input: { sessionId: string; reason: string }) => undefined);
    const f = await setup(
      {
        now: () => now,
        manageSession,
        createGoal: async () => ({ goalId: "goal" }),
        goalStatus: async () => ({
          status: "running",
          taskIds: [],
          sessionIds: ["s1"],
          progress: { done: 0, total: 1 },
          lastActivityAt: now - 20 * 60000,
        }),
      },
      autonomy,
    );
    vi.spyOn(f.store, "session").mockResolvedValue({
      status: "running",
      runId: "run1",
      runActivity: { runId: "run1", lastActivityAt: now - 20 * 60000 },
    } as never);
    await f.service.request(
      {
        op: "jobs.create",
        title: "Job",
        request: "Do work",
        projectId: "project",
        idempotencyKey: "stall",
      },
      "owner",
    );
    return { f, manageSession };
  }

  it("nudges a stalled worker once per stall", async () => {
    const { f, manageSession } = await stalledJob("jobs");
    await f.service.tick();
    await f.service.tick();
    await f.service.tick();
    expect(manageSession).toHaveBeenCalledTimes(1);
    expect(manageSession.mock.calls[0][0]).toMatchObject({ sessionId: "s1", reason: "nudge" });
    const activity = (await f.service.request({ op: "snapshot" }, "owner")).snapshot!.activity;
    expect(activity.filter((entry) => entry.kind === "session.nudged")).toHaveLength(1);
  });

  it("leaves nudges to the Chief in Chief mode and to the owner in report mode", async () => {
    for (const autonomy of ["chief", "report"] as const) {
      const { f, manageSession } = await stalledJob(autonomy);
      await f.service.tick();
      expect(manageSession).not.toHaveBeenCalled();
    }
  });

  it("admits worker recovery in Jobs and Chief modes but keeps other supervision Chief-only", async () => {
    const jobs = await setup({}, "jobs");
    expect(await jobs.service.workerRecoveryAllowed()).toBe(true);
    expect(await jobs.service.supervisionAllowed()).toBe(false);
    expect(await jobs.service.supervisionAllowed(true)).toBe(true);
    const chief = await setup({}, "chief");
    expect(await chief.service.workerRecoveryAllowed()).toBe(true);
    expect(await chief.service.supervisionAllowed()).toBe(true);
    const report = await setup({}, "report");
    expect(await report.service.workerRecoveryAllowed()).toBe(false);
  });
});

describe("done notification verification", () => {
  it("says nothing was recorded when no verification fields exist", () => {
    expect(describeVerification(undefined, [])).toBe(NO_VERIFICATION);
    expect(describeVerification({}, [{}])).toBe(NO_VERIFICATION);
  });
  it("describes only recorded results", () => {
    expect(
      describeVerification({ finalAcceptance: { status: "failed" } as never }, [
        { verification: { command: { exitCode: 1, output: "", timedOut: false } } },
        { completedWithFindings: true },
      ]),
    ).toBe(
      "The verify command failed for 1 task. 1 task finished with open findings. Final review did not accept the integrated result.",
    );
  });
  it("appends the verification line to the job summary", () => {
    expect(assistantJobNotificationBody("done", "Shipped.", undefined, 15, "Review passed.")).toBe(
      "Shipped. Review passed.",
    );
    expect(assistantJobNotificationBody("done", "", undefined, 15)).toBe(
      `Job is done. ${NO_VERIFICATION}`,
    );
  });
  it("reaches the job's done notification from the goal status", async () => {
    const f = await setup({
      createGoal: async () => ({ goalId: "goal" }),
      goalStatus: async () => ({
        status: "done",
        taskIds: [],
        sessionIds: [],
        progress: { done: 1, total: 1 },
        summary: "All shipped.",
        verification: "Final review accepted the integrated result.",
      }),
    });
    await f.service.request(
      {
        op: "jobs.create",
        title: "Job",
        request: "Do work",
        projectId: "project",
        idempotencyKey: "done",
      },
      "owner",
    );
    await f.service.tick();
    expect((await f.notices()).map((n) => [n.kind, n.body])).toEqual([
      ["job.done", "All shipped. Final review accepted the integrated result."],
    ]);
  });
});
