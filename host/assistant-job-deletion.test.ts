import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import { HostTasks } from "./tasks";
import { HostGoals } from "./goals";
import { HostAssistant } from "./assistant/service";
import { assistantExecutionPorts } from "./assistant-runtime";
import { assistantDomain } from "./assistant-domain";
import {
  AssistantRequestValidationSchema,
  AssistantResponseValidationSchema,
  type AssistantJob,
} from "../src/shared/model/host-contracts/assistant";
import { HostGoalSchema } from "../src/shared/model/host-contracts/goals";
import type { HostGoal } from "../src/features/tasks/model/hostGoals";
import type { HostTask } from "../src/features/tasks/model/hostTasks";
import type { HostProvider } from "./providers";
import type { SendTurnInput } from "../src/integrations/harness/core/types";

const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
const execution = {
  harness: "claude" as const,
  model: "claude:test",
  modelSettings: {},
  runtimeMode: "supervised" as const,
  maxRunMinutes: 60,
};
async function fixture(mode: "none" | "idle" | "running" = "none", count = 2) {
  const folder = realpathSync.native(mkdtempSync(join(tmpdir(), "assistant-job-delete-"))),
    store = new HostStore(join(folder, "host.db"));
  await store.ready;
  const project = await store.addProject(folder, "Delete fixture"),
    turns: Array<{ input: SendTurnInput; finish: () => void }> = [];
  const provider: HostProvider = {
    send: vi.fn(
      (input) =>
        new Promise<void>((finish) => {
          turns.push({ input, finish });
          input.onAccepted?.();
        }),
    ),
    cancel: vi.fn(async () => {
      turns.at(-1)?.finish();
    }),
    stop: vi.fn(async () => {}),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  provider.retireOriginal = provider.stop;
  const engine = new HostEngine(store, { claude: provider });
  await engine.ready;
  const tasks = new HostTasks(store, engine);
  await tasks.ready;
  const goals = new HostGoals(store, engine, tasks);
  await goals.ready;
  let now = Date.now();
  const ports = assistantExecutionPorts(store, goals, tasks);
  ports.now = () => now;
  ports.chiefWake = vi.fn(async () => ({ actions: [], tokens: 0 }));
  let assistant = new HostAssistant(store, ports);
  await assistant.ready;
  const rpc = (raw: unknown) =>
    assistantDomain(assistant, store)(raw, {
      principalId: "delete-owner",
      authorized: async () => true,
    });
  await rpc({
    op: "profile.update",
    expectedVersion: 0,
    patch: {
      name: "Delete fixture",
      enabled: true,
      setupComplete: true,
      autonomy: "report",
      dailyTokenBudget: 1000000,
      execution,
    },
  });
  const job = (
      await rpc({
        op: "jobs.create",
        title: "Retained job",
        request: "Keep all sessions and working files",
        projectId: project.id,
        idempotencyKey: "retained-deletion-job",
      })
    ).job!,
    goalId = `assistant-${job.id}`,
    ids = Array.from({ length: count }, (_, i) => `child-${i}`);
  let sessionId: string | undefined, runId: string | undefined;
  if (mode !== "none") {
    sessionId = (
      await engine.command({
        type: "create",
        commandId: "delete-worker-create",
        projectId: project.id,
        workspaceMode: "current",
        ...execution,
      })
    ).sessionId;
    runId = (
      await engine.command({
        type: "send",
        commandId: "delete-worker-root",
        sessionId,
        text: "Retain these files",
      })
    ).runId;
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    if (mode === "idle") {
      turns[0].finish();
      await engine.waitForRun(sessionId, runId);
    }
  }
  for (const [index, id] of ids.entries()) {
    await tasks.save({
      id,
      projectId: project.id,
      title: `Actual task ${index}`,
      prompt: "Preserve the retained files and history",
      ...execution,
      maxRunMinutes: 0,
      isolate: false,
      review: false,
      continueUntilDone: true,
    });
    await store.db
      .prepare("UPDATE tasks SET value=json_set(value,'$.goalId',?,'$.status',?) WHERE id=?")
      .run(goalId, index === 0 && mode === "running" ? "running" : "blocked", id);
    if (index === 0 && sessionId)
      await store.db
        .prepare(
          "UPDATE tasks SET value=json_set(value,'$.sessionId',?,'$.runId',?,'$.startedAt',?) WHERE id=?",
        )
        .run(sessionId, runId, now, id);
  }
  await store.db
    .prepare("INSERT INTO goals(id,value) VALUES(?,?)")
    .run(
      goalId,
      JSON.stringify({
        ...execution,
        id: goalId,
        title: job.title,
        prompt: job.request,
        projectIds: [project.id],
        leadProjectId: project.id,
        verifyDefaults: { review: false },
        approvePlan: true,
        autoMerge: false,
        isolate: false,
        continueUntilDone: true,
        finalReview: false,
        taskIds: ids,
        status: "running",
        createdAt: now,
        updatedAt: now,
      }),
    );
  await store.db
    .prepare(
      "UPDATE assistant_jobs SET value=json_set(value,'$.goalId',?,'$.taskIds',json(?),'$.sessionIds',json(?),'$.status','running') WHERE id=?",
    )
    .run(goalId, JSON.stringify(ids), JSON.stringify(sessionId ? [sessionId] : []), job.id);
  writeFileSync(join(folder, "retained.txt"), "Owner files remain exactly here");
  closes.push(async () => {
    await assistant.close();
    for (const turn of turns) turn.finish();
    await tasks.close();
    await engine.close();
    await store.close();
    rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
  });
  const current = async () =>
    JSON.parse(
      (await store.db.prepare("SELECT value FROM assistant_jobs WHERE id=?").get(job.id))!.value,
    ) as AssistantJob;
  const review = async () => {
    const value = await current();
    return (await rpc({ op: "jobs.deleteReview", id: job.id, expectedVersion: value.version }))
      .deleteReview!;
  };
  const remove = async () => {
    const scope = await review();
    return rpc({
      op: "jobs.control",
      id: job.id,
      expectedVersion: scope.jobVersion,
      action: "delete",
      deleteTasks: true,
      taskDeleteToken: scope.sourceToken,
    });
  };
  return {
    folder,
    store,
    project,
    engine,
    tasks,
    goals,
    ports,
    provider,
    turns,
    job,
    goalId,
    ids,
    sessionId,
    runId,
    rpc,
    current,
    review,
    remove,
    advance: (ms: number) => {
      now += ms;
    },
    get assistant() {
      return assistant;
    },
    restartAssistant: async () => {
      await assistant.close();
      assistant = new HostAssistant(store, ports);
      await assistant.ready;
    },
  };
}

it("reviews exact source, stops actual current work and atomically deletes only job/goal/task metadata with seven-day quiescent restore", async () => {
  const f = await fixture("running"),
    scope = await f.review();
  expect(scope.tasks.map((task) => task.id)).toEqual(f.ids);
  expect(scope.tasks[0].title).toBe("Actual task 0");
  expect(AssistantResponseValidationSchema.safeParse({ deleteReview: scope }).success).toBe(true);
  const response = await f.remove();
  expect(response.job!.status).toBe("cancelled");
  expect(f.provider.cancel).toHaveBeenCalledTimes(1);
  expect(f.engine.hasActiveRun(f.sessionId!)).toBe(false);
  expect(await f.tasks.list()).toEqual([]);
  expect(await f.goals.list()).toEqual([]);
  expect((await f.store.session(f.sessionId!)).session.id).toBe(f.sessionId);
  expect(readFileSync(join(f.folder, "retained.txt"), "utf8")).toBe(
    "Owner files remain exactly here",
  );
  const trash = (await f.rpc({ op: "snapshot" })).snapshot!.trash.find(
    (item) => item.id === `jobs:${f.job.id}`,
  );
  expect(trash?.deletedTaskCount).toBe(2);
  expect(trash!.expiresAt - trash!.deletedAt).toBe(7 * 86400000);
  const sends = vi.mocked(f.provider.send).mock.calls.length;
  await f.rpc({ op: "trash.restore", id: trash!.id });
  const restored = await f.current();
  expect(restored.status).toBe("paused");
  expect(restored.awaitingOwnerRestart).toBe(true);
  expect(
    (await f.tasks.list()).every((task) => task.status === "blocked" && task.awaitingOwnerRestart),
  ).toBe(true);
  const goal = (await f.goals.list())[0];
  expect(goal.status).toBe("cancelled");
  expect(HostGoalSchema.safeParse(goal).success).toBe(true);
  await f.tasks.tick();
  await f.assistant.tick();
  expect((await f.current()).status).toBe("paused");
  expect(f.provider.send).toHaveBeenCalledTimes(sends);
  expect((await f.store.session(f.sessionId!)).session.blocks.length).toBeGreaterThan(0);
  expect(readFileSync(join(f.folder, "retained.txt"), "utf8")).toBe(
    "Owner files remain exactly here",
  );
  expect(AssistantResponseValidationSchema.safeParse(await f.rpc({ op: "snapshot" })).success).toBe(
    true,
  );
});

it("keeps job-only deletion as the default and rejects task flags outside an explicitly reviewed Delete", async () => {
  const f = await fixture(),
    value = await f.current();
  await f.rpc({
    op: "jobs.control",
    id: value.id,
    expectedVersion: value.version,
    action: "delete",
  });
  expect(await f.tasks.list()).toHaveLength(2);
  expect(await f.goals.list()).toHaveLength(1);
  expect((await f.rpc({ op: "snapshot" })).snapshot!.trash[0].deletedTaskCount).toBeUndefined();
  for (const raw of [
    { action: "pause", deleteTasks: true, taskDeleteToken: "a".repeat(64) },
    { action: "delete", deleteTasks: true },
    { action: "delete", deleteTasks: false, taskDeleteToken: "a".repeat(64) },
  ])
    expect(
      AssistantRequestValidationSchema.safeParse({
        op: "jobs.control",
        id: value.id,
        expectedVersion: value.version,
        ...raw,
      }).success,
    ).toBe(false);
});

it("rejects changed review versions and actual task-set changes before any Stop or deletion hold", async () => {
  const f = await fixture("running"),
    scope = await f.review(),
    cancel = vi.spyOn(f.goals, "cancel");
  await f.store.db
    .prepare("UPDATE tasks SET value=json_set(value,'$.title','Owner changed the task') WHERE id=?")
    .run(f.ids[0]);
  await expect(
    f.rpc({
      op: "jobs.control",
      id: f.job.id,
      expectedVersion: scope.jobVersion,
      action: "delete",
      deleteTasks: true,
      taskDeleteToken: scope.sourceToken,
    }),
  ).rejects.toThrow("reviewed");
  expect(cancel).not.toHaveBeenCalled();
  expect(f.provider.cancel).not.toHaveBeenCalled();
  expect(f.tasks.isAssistantDeletionHeld(f.goalId)).toBe(false);
  expect((await f.current()).version).toBe(scope.jobVersion);
  const fresh = await f.review();
  await f.tasks.save({
    id: "unlisted-child",
    projectId: f.project.id,
    title: "A newly inserted task",
    prompt: "Keep me",
    ...execution,
    maxRunMinutes: 0,
    isolate: false,
    review: false,
    goalId: f.goalId,
  });
  await expect(
    f.rpc({
      op: "jobs.control",
      id: f.job.id,
      expectedVersion: fresh.jobVersion,
      action: "delete",
      deleteTasks: true,
      taskDeleteToken: fresh.sourceToken,
    }),
  ).rejects.toThrow("task set");
  expect(cancel).not.toHaveBeenCalled();
});

it("preserves unmerged work and unrelated dependencies, with a reversible Keep job and tasks recovery", async () => {
  const f = await fixture();
  await f.store.db
    .prepare(
      "UPDATE tasks SET value=json_set(value,'$.branch','retained-unmerged','$.merged',json('false')) WHERE id=?",
    )
    .run(f.ids[0]);
  await expect(f.remove()).rejects.toThrow("Unmerged");
  expect((await f.tasks.get(f.ids[0]))?.branch).toBe("retained-unmerged");
  expect(await f.tasks.list()).toHaveLength(2);
  expect(f.tasks.isAssistantDeletionHeld(f.goalId)).toBe(true);
  const value = await f.current();
  expect(
    (await f.rpc({ op: "jobs.deleteAbort", id: value.id, expectedVersion: value.version })).job!
      .status,
  ).toBe("paused");
  expect(f.tasks.isAssistantDeletionHeld(f.goalId)).toBe(false);
  expect(readFileSync(join(f.folder, "retained.txt"), "utf8")).toBe(
    "Owner files remain exactly here",
  );
});

it("rolls the whole metadata bundle back if canonical dependency protection refuses one selected task", async () => {
  const f = await fixture();
  await f.tasks.save({
    id: "outside-dependent",
    projectId: f.project.id,
    title: "An independent dependent",
    prompt: "Preserve this dependency",
    ...execution,
    maxRunMinutes: 0,
    isolate: false,
    review: false,
    dependsOn: [f.ids[1]],
  });
  await expect(f.remove()).rejects.toThrow("depend");
  expect(await f.tasks.list()).toHaveLength(3);
  expect(await f.goals.list()).toHaveLength(1);
  expect(
    (await f.rpc({ op: "snapshot" })).snapshot!.trash.filter(
      (item) => item.id === `jobs:${f.job.id}`,
    ),
  ).toEqual([]);
  expect(
    await f.store.db
      .prepare("SELECT value FROM assistant_job_deletions WHERE job_id=?")
      .get(f.job.id),
  ).toBeTruthy();
});

it("rolls back partial task deletion on durability failure and retries after actual retirement without replaying Stop", async () => {
  const f = await fixture(),
    cancel = vi.spyOn(f.goals, "cancel");
  await f.store.db.exec(
    `CREATE TRIGGER fail_selected_delete BEFORE DELETE ON tasks WHEN OLD.id='${f.ids[1]}' BEGIN SELECT RAISE(ABORT,'Fixture atomic deletion failure'); END`,
  );
  await expect(f.remove()).rejects.toThrow("Fixture atomic");
  expect(await f.tasks.list()).toHaveLength(2);
  expect(await f.goals.list()).toHaveLength(1);
  expect(cancel).toHaveBeenCalledTimes(1);
  await f.store.db.exec("DROP TRIGGER fail_selected_delete");
  await f.restartAssistant();
  await f.remove();
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(await f.tasks.list()).toEqual([]);
  expect(await f.goals.list()).toEqual([]);
});

it.each(["task", "goal"])(
  "refuses occupied %s identity during restore without partial resurrection or overwrite",
  async (kind) => {
    const f = await fixture();
    await f.remove();
    if (kind === "task")
      await f.tasks.save({
        id: f.ids[0],
        projectId: f.project.id,
        title: "New owner task",
        prompt: "Never overwrite",
        ...execution,
        maxRunMinutes: 0,
        isolate: false,
        review: false,
      });
    else
      await f.store.db
        .prepare("INSERT INTO goals(id,value) VALUES(?,?)")
        .run(
          f.goalId,
          JSON.stringify({
            ...execution,
            id: f.goalId,
            title: "New owner goal",
            prompt: "Never overwrite",
            projectIds: [f.project.id],
            leadProjectId: f.project.id,
            verifyDefaults: { review: false },
            approvePlan: true,
            autoMerge: false,
            taskIds: [],
            status: "cancelled",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }),
        );
    await expect(f.rpc({ op: "trash.restore", id: `jobs:${f.job.id}` })).rejects.toThrow(
      "occupied",
    );
    expect((await f.rpc({ op: "snapshot" })).snapshot!.jobs).toEqual([]);
    if (kind === "task") {
      expect((await f.tasks.get(f.ids[0]))?.title).toBe("New owner task");
      expect(await f.goals.list()).toEqual([]);
    } else {
      expect((await f.goals.list())[0].title).toBe("New owner goal");
      expect(await f.tasks.list()).toEqual([]);
    }
  },
);

it("expires restoration at seven days and purges its bundle with the existing job tombstone", async () => {
  const f = await fixture("idle");
  await f.remove();
  f.advance(7 * 86400000);
  await expect(f.rpc({ op: "trash.restore", id: `jobs:${f.job.id}` })).rejects.toThrow("expired");
  await f.assistant.tick();
  expect(
    await f.store.db
      .prepare("SELECT job_id FROM assistant_job_deletions WHERE job_id=?")
      .get(f.job.id),
  ).toBeUndefined();
  await expect(
    f.rpc({
      op: "jobs.create",
      title: f.job.title,
      request: f.job.request,
      projectId: f.project.id,
      idempotencyKey: f.job.idempotencyKey,
    }),
  ).rejects.toThrow("permanently deleted");
  expect((await f.store.session(f.sessionId!)).session.id).toBe(f.sessionId);
  expect(readFileSync(join(f.folder, "retained.txt"), "utf8")).toBe(
    "Owner files remain exactly here",
  );
});

it("keeps interrupted Stop unknown, then releases only the deletion hold without reviving worker or planner admission", async () => {
  const f = await fixture("idle"),
    record = await f.store.session(f.sessionId!);
  await f.store.save(
    { ...record, status: "interrupted", revision: record.revision + 1 },
    { type: "fixture.interrupted" },
  );
  await expect(f.remove()).rejects.toThrow("interrupted source");
  await f.assistant.tick();
  const sends = vi.mocked(f.provider.send).mock.calls.length,
    cancels = vi.mocked(f.provider.cancel).mock.calls.length,
    value = await f.current();
  expect(value.status).toBe("waiting");
  expect(value.pendingTaskDeletion).toBe(true);
  expect(f.tasks.isAssistantDeletionHeld(f.goalId)).toBe(true);
  const kept = (
    await f.rpc({ op: "jobs.deleteAbort", id: value.id, expectedVersion: value.version })
  ).job!;
  expect(kept.status).toBe("paused");
  expect(kept.pendingTaskDeletion).toBe(false);
  expect(kept.summary).toContain("retirement is still unknown");
  expect(f.tasks.isAssistantDeletionHeld(f.goalId)).toBe(false);
  expect((await f.store.session(f.sessionId!)).status).toBe("interrupted");
  expect((await f.tasks.list()).every((task) => task.awaitingOwnerRestart)).toBe(true);
  await f.tasks.tick();
  expect(f.provider.send).toHaveBeenCalledTimes(sends);
  expect(f.provider.cancel).toHaveBeenCalledTimes(cancels);
  const goalEngine = (
    f.goals as unknown as {
      engine: { withMessageAuthor: NonNullable<HostEngine["withMessageAuthor"]> };
    }
  ).engine;
  await expect(
    goalEngine.withMessageAuthor(
      { kind: "task", id: f.goalId, name: "Original planner", reason: "planning" },
      () =>
        f.engine.command({
          type: "send",
          commandId: "stale-planner-after-keep",
          sessionId: f.sessionId,
          text: "Must never revive",
        }),
    ),
  ).rejects.toThrow("owner restart");
  expect(f.provider.send).toHaveBeenCalledTimes(sends);
  expect(
    await f.store.db
      .prepare("SELECT value FROM assistant_job_deletion_history WHERE job_id=?")
      .get(f.job.id),
  ).toBeTruthy();
  expect(
    (await f.rpc({ op: "jobs.deleteAbort", id: kept.id, expectedVersion: kept.version })).job!
      .version,
  ).toBe(kept.version);
});

it("never stops a replacement owner turn after an old deletion review", async () => {
  const f = await fixture("idle"),
    scope = await f.review(),
    cancel = vi.spyOn(f.goals, "cancel");
  await f.engine.command({
    type: "send",
    commandId: "replacement-owner-turn",
    sessionId: f.sessionId,
    text: "Owner's independent follow-up",
  });
  await vi.waitFor(() => expect(f.turns).toHaveLength(2));
  const replacement = (await f.store.session(f.sessionId!)).runId;
  await expect(
    f.rpc({
      op: "jobs.control",
      id: f.job.id,
      expectedVersion: scope.jobVersion,
      action: "delete",
      deleteTasks: true,
      taskDeleteToken: scope.sourceToken,
    }),
  ).rejects.toThrow("replaced");
  expect(cancel).not.toHaveBeenCalled();
  expect(f.provider.cancel).not.toHaveBeenCalled();
  expect((await f.store.session(f.sessionId!)).runId).toBe(replacement);
  expect(await f.tasks.list()).toHaveLength(2);
});

it("fences a captured original Goal command after metadata deletion releases its hold", async () => {
  const f = await fixture("idle"),
    entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>(),
    goalEngine = (
      f.goals as unknown as {
        engine: { withMessageAuthor: NonNullable<HostEngine["withMessageAuthor"]> };
      }
    ).engine;
  const stale = goalEngine.withMessageAuthor(
    { kind: "task", id: f.goalId, name: "Original planner", reason: "planning" },
    async () => {
      entered.resolve();
      await release.promise;
      return f.engine.command({
        type: "send",
        commandId: "captured-planner-after-delete",
        sessionId: f.sessionId,
        text: "Never revive this captured command",
      });
    },
  );
  const observed = stale.catch((error) => error);
  await entered.promise;
  await f.remove();
  expect(f.tasks.isAssistantDeletionHeld(f.goalId)).toBe(false);
  release.resolve();
  expect(String(await observed)).toContain("deleted or awaits");
  expect(f.provider.send).toHaveBeenCalledTimes(1);
  expect((await f.store.session(f.sessionId!)).runId).toBe(f.runId);
});

it("keeps ordinary new assistant planners functional while persisting their source before provider dispatch", async () => {
  const f = await fixture(),
    created = await f.goals.create({
      ...execution,
      id: "assistant-new-planner-fixture",
      title: "New planner source",
      prompt: "Plan only",
      projectIds: [f.project.id],
      leadProjectId: f.project.id,
      verifyDefaults: { review: false },
      approvePlan: true,
      autoMerge: false,
      isolate: false,
      continueUntilDone: true,
      finalReview: false,
    });
  expect(created.status).toBe("planning");
  await vi.waitFor(() => expect(f.provider.send).toHaveBeenCalledTimes(1));
  expect((await f.goals.list()).find((goal) => goal.id === created.id)?.plannerRunId).toBe(
    created.plannerRunId,
  );
  expect(f.tasks.isAssistantDeletionHeld(created.id)).toBe(false);
});

it("does not restart an assistant planner while its original preparation is still in flight", async () => {
  const f = await fixture(),
    goal = (await f.goals.list())[0],
    entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>(),
    evaluate = f.tasks.budgets.evaluate.bind(f.tasks.budgets);
  vi.spyOn(f.tasks.budgets, "evaluate").mockImplementation(async (...args) => {
    entered.resolve();
    await release.promise;
    return evaluate(...args);
  });
  const internal = f.goals as unknown as { plan(goal: HostGoal): Promise<HostGoal> };
  const first = internal.plan(goal);
  await entered.promise;
  const duplicate = await internal.plan(goal);
  expect(duplicate.status).toBe("planning");
  expect(f.tasks.budgets.evaluate).toHaveBeenCalledTimes(1);
  release.resolve();
  await first;
  await vi.waitFor(() => expect(f.provider.send).toHaveBeenCalledTimes(1));
});

it("rejects stale asynchronous metadata callbacks after deletion and quiescent restoration", async () => {
  const f = await fixture(),
    goal = (await f.goals.list())[0],
    task = (await f.tasks.list())[0];
  await f.remove();
  const oldGoals = f.goals as unknown as { write(goal: HostGoal): Promise<HostGoal> },
    oldTasks = f.tasks as unknown as { write(task: HostTask): Promise<HostTask> };
  await expect(
    oldGoals.write({ ...goal, status: "blocked", planError: "Old planner callback" }),
  ).rejects.toThrow("deleted or awaits");
  await expect(
    oldTasks.write({ ...task, status: "blocked", error: "Old worker callback" }),
  ).rejects.toThrow("stale callbacks");
  expect(await f.goals.list()).toEqual([]);
  expect(await f.tasks.list()).toEqual([]);
  await f.rpc({ op: "trash.restore", id: `jobs:${f.job.id}` });
  await expect(oldGoals.write(goal)).rejects.toThrow("owner restart");
  await expect(oldTasks.write(task)).rejects.toThrow("stale callbacks");
  expect((await f.tasks.get(task.id))?.awaitingOwnerRestart).toBe(true);
  expect((await f.goals.list())[0].awaitingOwnerRestart).toBe(true);
});
