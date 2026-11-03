import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "./store";
import { HostAssistant } from "./assistant/service";
import {
  HostAssistantSessions,
  type AssistantSessionPorts,
  type AssistantSessionStatus,
} from "./assistant-sessions";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const chief = { kind: "chief" as const, id: "trusted-chief" };
async function detachable(f: Awaited<ReturnType<typeof setup>>) {
  const row = await f.store.db.prepare("SELECT value FROM assistant_jobs WHERE id=?").get(f.job.id);
  const job = JSON.parse(row!.value);
  await f.store.db.exec(
    "CREATE TABLE IF NOT EXISTS goals(id TEXT PRIMARY KEY,value TEXT NOT NULL)",
  );
  await f.store.db.prepare("INSERT OR REPLACE INTO goals(id,value) VALUES(?,?)").run(
    job.goalId,
    JSON.stringify({
      id: job.goalId,
      leadProjectId: "project",
      projectIds: ["project"],
      taskIds: [],
      plannerSessionId: "owned",
    }),
  );
  return job;
}
it("withdraws one canonical session durably without stopping its worker or replaying a lost acknowledgement", async () => {
  const f = await setup();
  const before = await detachable(f);
  expect(await f.managed.detach(f.job.id, "owned", before.version)).toEqual({ detached: true });
  const saved = JSON.parse(
    (await f.store.db.prepare("SELECT value FROM assistant_jobs WHERE id=?").get(f.job.id))!.value,
  );
  expect(saved).toMatchObject({
    status: before.status,
    taskIds: before.taskIds,
    sessionIds: before.sessionIds,
    detachedSessionIds: ["owned"],
    version: before.version + 1,
  });
  await expect(f.nudge()).rejects.toThrow("detached");
  await f.managed.detach(f.job.id, "owned", before.version);
  expect(
    JSON.parse(
      (await f.store.db.prepare("SELECT value FROM assistant_jobs WHERE id=?").get(f.job.id))!
        .value,
    ).version,
  ).toBe(saved.version);
  await f.restart();
  await expect(f.nudge("after-restart")).rejects.toThrow("detached");
  expect(f.sent).toHaveLength(0);
  expect(f.charges).toHaveLength(0);
});
it("refuses stale or foreign withdrawals without fencing the current worker", async () => {
  const f = await setup();
  const job = await detachable(f);
  await expect(f.managed.detach(job.id, "owned", job.version + 1)).rejects.toThrow("changed");
  await expect(f.managed.detach(job.id, "foreign-session", job.version)).rejects.toThrow(
    "not started",
  );
  await f.store.db.prepare("DELETE FROM goals WHERE id=?").run(job.goalId);
  await expect(f.managed.detach(job.id, "owned", job.version)).rejects.toThrow("canonical");
  await f.nudge();
  expect(f.sent).toHaveLength(1);
});
it("fences a reserved follow-up before provider delivery when the owner detaches its session", async () => {
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>((resolve) => (entered = resolve)),
    gate = new Promise<void>((resolve) => (release = resolve));
  const f = await setup({
    reserveTokens: async () => {
      entered();
      await gate;
    },
  });
  const job = await detachable(f);
  const pending = f.nudge();
  await waiting;
  await f.managed.detach(job.id, "owned", job.version);
  release();
  expect((await pending).operation?.delivery).toBe("unknown");
  expect(f.sent).toHaveLength(0);
});
it("keeps accepted follow-up history when optional task-cache notification fails", async () => {
  const onActivity = vi.fn(),
    onReceiptNotificationError = vi.fn(() => {
      throw new Error("Diagnostic sink unavailable");
    });
  const f = await setup({
    onActivity,
    onReceiptNotificationError,
    onReceiptChanged: async () => {
      throw new Error("Metadata cache unavailable");
    },
  });
  expect((await f.nudge()).operation).toMatchObject({ state: "settled", delivery: "delivered" });
  expect(f.sent).toHaveLength(1);
  expect(onActivity).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "session.nudged", sessionId: "owned" }),
  );
  expect(onReceiptNotificationError).toHaveBeenCalledOnce();
});
it("disables nudges without starting recovery when the saved limit is zero", async () => {
  const recoverWorker = vi.fn();
  const f = await setup({ nudgeLimit: async () => 0, recoverWorker });
  await expect(f.nudge()).rejects.toThrow("disabled");
  expect(f.sent).toHaveLength(0);
  expect(f.charges).toHaveLength(0);
  expect(recoverWorker).not.toHaveBeenCalled();
});
it("allows one follow-up and then uses the canonical recovery port for a saved limit of one", async () => {
  const recoverWorker = vi.fn(async (input) => {
    await input.recheck();
    return { taskId: "task", state: "queued" as const, message: "Canonical recovery queued" };
  });
  const f = await setup({ nudgeLimit: async () => 1, recoverWorker });
  await f.nudge("first");
  expect(f.sent).toHaveLength(1);
  expect((await f.nudge("second")).recovery?.state).toBe("queued");
  expect(f.sent).toHaveLength(1);
  expect(recoverWorker).toHaveBeenCalledOnce();
});
it("rechecks a disabled nudge policy after reservation before any provider effect", async () => {
  let limit = 2;
  const f = await setup({
    nudgeLimit: async () => limit,
    reserveTokens: async () => {
      limit = 0;
    },
  });
  expect((await f.nudge()).operation?.state).toBe("unknown");
  expect(f.sent).toHaveLength(0);
});
async function setup(overrides: Partial<AssistantSessionPorts> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-managed-session-"));
  const path = join(dir, "host.db");
  let store = new HostStore(path);
  await store.ready;
  const corePorts = {
    listProjects: async () => [{ id: "project", path: dir, name: "Project" }],
    createGoal: async ({ job }: { job: { id: string } }) => ({ goalId: `assistant-${job.id}` }),
    goalStatus: async () => ({
      status: "running" as const,
      taskIds: ["task"],
      sessionIds: ["owned"],
      progress: { done: 0, total: 1 },
    }),
  };
  let core = new HostAssistant(store, corePorts);
  await core.ready;
  await core.request(
    {
      op: "profile.update",
      expectedVersion: 0,
      patch: {
        name: "Owner Name",
        autonomy: "chief",
        dailyTokenBudget: 1000000,
        setupComplete: true,
        enabled: true,
        execution: {
          harness: "codex",
          model: "model",
          modelSettings: {},
          runtimeMode: "supervised",
          maxRunMinutes: 60,
        },
      },
    },
    "owner",
  );
  const job = (
    await core.request(
      {
        op: "jobs.create",
        title: "Managed work",
        request: "Do work",
        projectId: "project",
        idempotencyKey: "create-job",
      },
      "owner",
    )
  ).job!;
  let status: AssistantSessionStatus = {
    sessionId: "owned",
    projectId: "project",
    title: "Worker",
    executionCwd: dir,
    state: "running",
    runId: "run-1",
    authorityGeneration: 3,
    lastActivityAt: Date.now(),
    contextTokens: 40000,
    contextWindow: 1000000,
    pendingApproval: false,
    pendingQuestion: false,
    lastAssistantMessage: "Working",
  };
  const sent: Parameters<NonNullable<AssistantSessionPorts["send"]>>[0][] = [];
  const charges: Parameters<AssistantSessionPorts["reserveTokens"]>[0][] = [];
  const ports: AssistantSessionPorts = {
    allowed: async () => true,
    status: async () => ({ ...status }),
    reserveTokens: async (input) => {
      charges.push(input);
    },
    send: async (input) => {
      sent.push(input);
      return { delivery: "delivered" };
    },
    ...overrides,
  };
  let managed = new HostAssistantSessions(store, ports);
  await managed.ready;
  const f = {
    job,
    dir,
    sent,
    charges,
    get managed() {
      return managed;
    },
    get store() {
      return store;
    },
    get status() {
      return status;
    },
    setStatus: (patch: Partial<AssistantSessionStatus>) => {
      status = { ...status, ...patch };
    },
    nudge: (requestId = "one", text = "Continue the assigned work") =>
      managed.request(
        { op: "nudge", jobId: job.id, sessionId: "owned", requestId, text, reason: "nudge" },
        chief,
      ),
    restart: async () => {
      await managed.close();
      await core.close();
      await store.close();
      store = new HostStore(path);
      await store.ready;
      core = new HostAssistant(store, corePorts);
      await core.ready;
      managed = new HostAssistantSessions(store, ports);
      await managed.ready;
    },
  };
  cleanups.push(async () => {
    await managed.close();
    await core.close();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return f;
}
it("grants status only for durable assistant-owned job sessions and captured supervisors", async () => {
  const f = await setup();
  const status = (
    await f.managed.request({ op: "status", jobId: f.job.id, sessionId: "owned" }, chief)
  ).status!;
  expect(status.contextAction).toBe("send");
  expect(status.lastAssistantMessage).toBe("Working");
  await expect(
    f.managed.request({ op: "status", jobId: f.job.id, sessionId: "manual" }, chief),
  ).rejects.toThrow("Manual sessions");
  await expect(
    f.managed.request({ op: "status", jobId: f.job.id, sessionId: "owned" }, {
      kind: "owner",
      id: "owner",
    } as never),
  ).rejects.toThrow("supervisor");
  await expect(
    f.managed.request(
      {
        op: "nudge",
        jobId: f.job.id,
        sessionId: "owned",
        requestId: "forged",
        text: "continue",
        reason: "nudge",
        author: { kind: "owner" },
      },
      chief,
    ),
  ).rejects.toThrow();
});
it("uses persisted worker limits for status and the final nudge admission", async () => {
  const f = await setup();
  const patch = async (value: Record<string, number>) => {
    const row = await f.store.db
      .prepare("SELECT value FROM assistant_profile WHERE id='profile'")
      .get();
    await f.store.db
      .prepare("UPDATE assistant_profile SET value=? WHERE id='profile'")
      .run(JSON.stringify({ ...JSON.parse(row!.value), ...value }));
  };
  await patch({ workerSoftContext: 10000, workerHardContext: 30000 });
  expect(
    (await f.managed.request({ op: "status", jobId: f.job.id, sessionId: "owned" }, chief)).status
      ?.contextAction,
  ).toBe("handoff");
  await expect(f.nudge()).rejects.toThrow("fresh-session handoff");
  expect(f.sent).toEqual([]);
  await patch({ workerSoftContext: 150000, workerHardContext: 300000 });
  let currentStore!: HostStore;
  const reserve = vi.fn(async () => {
    const row = await currentStore.db
      .prepare("SELECT value FROM assistant_profile WHERE id='profile'")
      .get();
    await currentStore.db.prepare("UPDATE assistant_profile SET value=? WHERE id='profile'").run(
      JSON.stringify({
        ...JSON.parse(row!.value),
        workerSoftContext: 10000,
        workerHardContext: 30000,
      }),
    );
  });
  const g = await setup({ reserveTokens: reserve });
  currentStore = g.store;
  expect((await g.nudge()).operation?.delivery).toBe("unknown");
  expect(reserve).toHaveBeenCalledTimes(1);
  expect(g.sent).toEqual([]);
});
it("fallback status uses exact current-run output activity and never treats refreshed row timestamps as progress", async () => {
  const f = await setup({ status: undefined });
  const record = {
    projectId: "project",
    runId: "current",
    status: "running",
    updatedAt: Date.now(),
    runActivity: { runId: "current", lastActivityAt: 1000 },
    session: { id: "owned", title: "Worker", cwd: f.dir, blocks: [] },
  } as any;
  vi.spyOn(f.store, "session").mockResolvedValue(record);
  const read = async () =>
    (await f.managed.request({ op: "status", jobId: f.job.id, sessionId: "owned" }, chief)).status!;
  expect((await read()).lastActivityAt).toBe(1000);
  record.updatedAt = Date.now() + 1;
  expect((await read()).lastActivityAt).toBe(1000);
  record.runActivity.runId = "old";
  expect(await read()).not.toHaveProperty("lastActivityAt");
  record.runActivity = undefined;
  expect(await read()).not.toHaveProperty("lastActivityAt");
});
it("books full context, stamps the Host author and limits attempts to two across restarts", async () => {
  const f = await setup();
  expect((await f.nudge()).operation!.delivery).toBe("delivered");
  expect(f.charges[0].estimatedTokens).toBeGreaterThan(40000);
  expect(f.sent[0].author).toMatchObject({
    kind: "assistant",
    name: "Owner Name",
    jobId: f.job.id,
    reason: "nudge",
  });
  expect(f.sent[0].source).toMatchObject({
    runId: "run-1",
    authorityGeneration: 3,
    executionCwd: f.dir,
  });
  await f.nudge();
  expect(f.sent).toHaveLength(1);
  await f.restart();
  await f.nudge("two");
  expect(f.sent).toHaveLength(2);
  await expect(f.nudge("three")).rejects.toThrow("two-nudge");
  await expect(f.nudge("one", "Different content")).rejects.toThrow("preserve");
});
it("compacts before sending into medium contexts and verifies the resulting reading", async () => {
  let f: Awaited<ReturnType<typeof setup>>;
  let compacted = 0;
  f = await setup({
    compact: async () => {
      compacted++;
      f.setStatus({ contextTokens: 35000 });
      return { completed: true };
    },
  });
  f.setStatus({ contextTokens: 200000 });
  const result = await f.nudge();
  expect(result.operation!.action).toBe("compact");
  expect(compacted).toBe(1);
  expect(f.sent).toHaveLength(1);
  expect(f.charges.map((charge) => charge.phase)).toEqual(["compact", "send"]);
  const ineffective = await setup({ compact: async () => ({ completed: true }) });
  ineffective.setStatus({ contextTokens: 200000 });
  expect((await ineffective.nudge()).operation!.state).toBe("unknown");
  expect(ineffective.sent).toHaveLength(0);
});
it("requires a task-owner handoff for very large context instead of another send", async () => {
  const missing = await setup();
  missing.setStatus({ contextTokens: 750000 });
  await expect(missing.nudge()).rejects.toThrow("handoff");
  expect(missing.sent).toHaveLength(0);
  let handoffs = 0;
  const supported = await setup({
    handoff: async ({ source, author }) => {
      expect(source.runId).toBe("run-1");
      expect(author.jobId).toBe(supported.job.id);
      handoffs++;
      return { delivery: "delivered", newSessionId: "fresh-owned" };
    },
  });
  supported.setStatus({ contextTokens: 750000 });
  const result = await supported.nudge();
  expect(result.operation!.newSessionId).toBe("fresh-owned");
  expect(handoffs).toBe(1);
  expect(supported.sent).toHaveLength(0);
  expect(supported.charges[0].estimatedTokens).toBeGreaterThan(750000);
});
it("treats unknown context as requiring confirmed compaction and never sends when still unknown", async () => {
  let f: Awaited<ReturnType<typeof setup>>;
  let compactions = 0;
  f = await setup({
    compact: async () => {
      compactions++;
      f.setStatus({ contextTokens: 10000 });
      return { completed: true };
    },
  });
  f.setStatus({ contextTokens: undefined });
  await f.nudge();
  expect(compactions).toBe(1);
  expect(f.sent).toHaveLength(1);
  const unknown = await setup({ compact: async () => ({ completed: true }) });
  unknown.setStatus({ contextTokens: undefined, contextWindow: undefined });
  expect((await unknown.nudge()).operation!.state).toBe("unknown");
  expect(unknown.sent).toHaveLength(0);
});
it("keeps approvals and owner questions with the owner and fences changed turns", async () => {
  const f = await setup();
  f.setStatus({ pendingApproval: true });
  await expect(f.nudge()).rejects.toThrow("owner approval");
  f.setStatus({
    pendingApproval: false,
    pendingQuestion: true,
    questionId: "question",
    questionOwnerRequired: true,
  });
  await expect(f.nudge()).rejects.toThrow("owner's answer");
  expect(f.sent).toHaveLength(0);
  let reads = 0;
  const raced = await setup({
    status: async () => ({
      sessionId: "owned",
      projectId: "project",
      title: "Worker",
      executionCwd: raced.dir,
      state: "running",
      runId: ++reads === 1 ? "original" : "replacement",
      lastActivityAt: 1,
      contextTokens: 10000,
      contextWindow: 1000000,
      pendingApproval: false,
      pendingQuestion: false,
      lastAssistantMessage: "",
    }),
  });
  expect((await raced.nudge()).operation!.state).toBe("unknown");
  expect(raced.sent).toHaveLength(0);
});
it("does not replay uncertain provider writes after restart", async () => {
  let calls = 0;
  const f = await setup({
    send: async () => {
      calls++;
      throw new Error("transport lost after delivery");
    },
  });
  expect((await f.nudge()).operation!.delivery).toBe("unknown");
  await f.restart();
  expect((await f.nudge()).operation!.delivery).toBe("unknown");
  expect(calls).toBe(1);
});
it("aborts pending maintenance on stop and never delivers its delayed nudge", async () => {
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let aborted = false;
  const f = await setup({
    compact: async ({ signal }) => {
      entered();
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("stopped"));
          },
          { once: true },
        ),
      );
    },
  });
  f.setStatus({ contextTokens: 200000 });
  const waiting = f.nudge();
  await started;
  f.managed.stop();
  expect((await waiting).operation!.state).toBe("unknown");
  expect(aborted).toBe(true);
  expect(f.sent).toHaveLength(0);
});
