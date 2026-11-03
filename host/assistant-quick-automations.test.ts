import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "./store";
import { HostTasks } from "./tasks";
import { HostGoals } from "./goals";
import { HostAutomations } from "./automations";
import { HostAssistant } from "./assistant/service";
import { assistantExecutionPorts } from "./assistant-runtime";
import { assistantDomain } from "./assistant-domain";
import {
  HostAssistantQuickAutomations,
  assistantQuickAutomationId,
  assistantQuickAutomationFingerprint,
  assistantQuickAutomationConfiguration,
} from "./assistant-quick-automations";
import {
  normalizeAssistantQuickAutomationAction,
  type AssistantQuickAutomationAction,
} from "../src/shared/model/assistantQuickAutomation";
import { assistantJobProjectIds } from "../src/shared/model/assistantProjects";
import {
  AssistantRequestValidationSchema,
  AssistantResponseValidationSchema,
  type AssistantQuickAutomationJob,
} from "../src/shared/model/host-contracts/assistant";
import { assertAssistantGoalProjects } from "./assistant-job-scope";

const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}
async function fixture() {
  const folder = mkdtempSync(join(tmpdir(), "assistant-quick-automation-")),
    path = join(folder, "host.db");
  let store: HostStore,
    tasks: HostTasks,
    goals: HostGoals,
    automations: HostAutomations,
    assistant: HostAssistant,
    ownerAllowed = true;
  const engine = {
    command: vi.fn(async () => {
      throw new Error("Creation must not start a provider or session");
    }),
    updateSession: vi.fn(async () => {
      throw new Error("Creation must not edit sessions");
    }),
  };
  async function open() {
    store = new HostStore(path);
    await store.ready;
    tasks = new HostTasks(store, engine);
    await tasks.ready;
    goals = new HostGoals(store, engine, tasks);
    await goals.ready;
    automations = new HostAutomations(store, engine);
    await automations.ready;
    const ports = assistantExecutionPorts(store, goals, tasks, undefined, () => automations);
    ports.createGoal = vi.fn(async () => {
      throw new Error("Quick creation must not create a Goal");
    });
    ports.chiefWake = vi.fn(async () => {
      throw new Error("Quick creation must not wake a model");
    });
    ports.onJobPause = vi.fn();
    assistant = new HostAssistant(store, ports);
    await assistant.ready;
    return ports;
  }
  let ports = await open();
  const project = await store!.addProject(folder, "Automation target"),
    rpc = (raw: unknown) =>
      assistantDomain(assistant, store)(raw, {
        principalId: "automation-owner",
        authorized: async () => ownerAllowed,
      });
  await rpc({
    op: "profile.update",
    expectedVersion: 0,
    patch: {
      name: "Automation fixture",
      autonomy: "report",
      enabled: true,
      setupComplete: true,
      dailyTokenBudget: 1000000,
      execution: {
        harness: "claude",
        model: "unrelated-profile-model",
        modelSettings: {},
        runtimeMode: "supervised",
        maxRunMinutes: 60,
      },
    },
  });
  closes.push(async () => {
    await assistant.close();
    await automations.close();
    await tasks.close();
    await store.close();
    rmSync(folder, { recursive: true, force: true });
  });
  const action: AssistantQuickAutomationAction = {
    kind: "automation",
    projectId: project.id,
    name: "  Reviewed schedule  ",
    prompt: "Prepare the existing local report on this schedule.",
    harness: "codex",
    model: "codex:explicit-model",
    modelSettings: { reasoning: "low", account: "already-selected-account" },
    runtimeMode: "supervised",
    scheduleKind: "daily",
    minute: 0,
    time: "09:30",
    dayOfWeek: 1,
    maxRunMinutes: 20,
    maxRunsPerDay: 2,
    isolate: false,
    enabled: true,
  };
  const input = (key = "reviewed-automation") => ({
    op: "jobs.create" as const,
    kind: "quick" as const,
    title: "Set up the reviewed schedule",
    request: "Create this exact reviewed project automation",
    idempotencyKey: key,
    quickAction: action,
  });
  return {
    folder,
    path,
    project,
    engine,
    action,
    input,
    rpc,
    get store() {
      return store;
    },
    get tasks() {
      return tasks;
    },
    get goals() {
      return goals;
    },
    get automations() {
      return automations;
    },
    get assistant() {
      return assistant;
    },
    get ports() {
      return ports;
    },
    setOwnerAllowed: (value: boolean) => (ownerAllowed = value),
    restart: async () => {
      await assistant.close();
      await automations.close();
      await tasks.close();
      await store.close();
      ports = await open();
    },
    job: async () =>
      JSON.parse(
        (await store.db.prepare("SELECT value FROM assistant_jobs LIMIT 1").get())!.value,
      ) as AssistantQuickAutomationJob,
  };
}
function standalone(
  id: string,
  action: AssistantQuickAutomationAction,
): AssistantQuickAutomationJob {
  const now = Date.now();
  return {
    id,
    kind: "quick",
    version: 1,
    createdAt: now,
    updatedAt: now,
    title: "Reviewed creation",
    request: "Exact request",
    projectId: action.projectId,
    projectIds: [action.projectId],
    quickAction: normalizeAssistantQuickAutomationAction(action),
    status: "running",
    taskIds: [],
    sessionIds: [],
    progress: { done: 0, total: 1 },
    summary: "",
    tokens: 0,
    tokensComplete: true,
    idempotencyKey: id,
    dispatchState: "unknown",
  };
}

it("creates exactly the explicitly reviewed real project automation in Report mode without running it or inheriting provider policy", async () => {
  const f = await fixture(),
    save = vi.spyOn(f.automations, "save"),
    result = await f.rpc(f.input()),
    job = result.job!;
  expect(job.kind).toBe("quick");
  if (job.kind !== "quick" || job.projectId === null) throw new Error("Wrong scoped quick receipt");
  expect(job.status).toBe("done");
  expect(job.projectIds).toEqual([f.project.id]);
  expect(assistantJobProjectIds(job)).toEqual([f.project.id]);
  expect(job.taskIds).toEqual([]);
  expect(job.sessionIds).toEqual([]);
  expect(job.goalId).toBeUndefined();
  expect(job.tokens).toBe(0);
  expect(job.quickResult?.automationId).toBe(assistantQuickAutomationId(job.id));
  const created = (await f.automations.list())[0],
    { kind: _, ...reviewed } = normalizeAssistantQuickAutomationAction(f.action);
  expect(created).toMatchObject(reviewed);
  expect(created.nextRunAt).toBeGreaterThan(Date.now() - 1000);
  expect(created.lastSessionId).toBeUndefined();
  expect(save).toHaveBeenCalledTimes(1);
  expect(await f.automations.runs(created.id)).toEqual([]);
  expect(await f.tasks.list()).toEqual([]);
  expect(await f.goals.list()).toEqual([]);
  expect(f.engine.command).not.toHaveBeenCalled();
  expect(f.ports.createGoal).not.toHaveBeenCalled();
  expect(f.ports.chiefWake).not.toHaveBeenCalled();
  expect(AssistantResponseValidationSchema.safeParse(result).success).toBe(true);
  const snapshot = (await f.rpc({ op: "snapshot" })).snapshot!;
  expect(snapshot.capabilities.quickAutomations).toBe(true);
  expect(snapshot.usage.total).toBe(0);
  expect(() =>
    assertAssistantGoalProjects(job, {
      id: `assistant-${job.id}`,
      projectIds: [f.project.id],
      leadProjectId: f.project.id,
    }),
  ).toThrow("quick jobs");
  expect(() =>
    assistantJobProjectIds({ ...job, projectIds: [f.project.id, "hidden-unrelated-project"] }),
  ).toThrow("project scope changed");
  expect(() => assistantJobProjectIds({ ...job, projectId: null })).toThrow(
    "project scope changed",
  );
});

it("requires owner review, actual project and every finite schedule/provider/limit field", async () => {
  const f = await fixture();
  await expect(f.assistant.request(f.input(), "chief")).rejects.toThrow("owner");
  await expect(
    f.rpc({ ...f.input(), quickAction: { ...f.action, projectId: "missing-project" } }),
  ).rejects.toThrow("Project");
  for (const key of [
    "model",
    "runtimeMode",
    "isolate",
    "enabled",
    "maxRunMinutes",
    "maxRunsPerDay",
    "scheduleKind",
    "minute",
    "time",
    "dayOfWeek",
  ]) {
    const action = { ...f.action } as Record<string, unknown>;
    delete action[key];
    expect(
      AssistantRequestValidationSchema.safeParse({ ...f.input(), quickAction: action }).success,
    ).toBe(false);
  }
  expect(
    AssistantRequestValidationSchema.safeParse({ ...f.input(), projectId: f.project.id }).success,
  ).toBe(false);
  expect(
    AssistantRequestValidationSchema.safeParse({
      ...f.input(),
      quickAction: { ...f.action, runNow: true },
    }).success,
  ).toBe(false);
  expect(
    AssistantRequestValidationSchema.safeParse({
      ...f.input(),
      quickAction: { ...f.action, time: "24:00" },
    }).success,
  ).toBe(false);
  expect(await f.automations.list()).toEqual([]);
  expect(f.engine.command).not.toHaveBeenCalled();
});

it("deduplicates exact reviewed configuration and preserves completed creation proof after owner edits and SQLite reopen", async () => {
  const f = await fixture(),
    first = (await f.rpc(f.input())).job!;
  expect((await f.rpc(f.input())).job!.id).toBe(first.id);
  await expect(
    f.rpc({ ...f.input(), quickAction: { ...f.action, maxRunsPerDay: 3 } }),
  ).rejects.toThrow("original request");
  const original = (await f.automations.list())[0];
  await f.automations.save({
    ...original,
    name: "Owner's later name",
    enabled: false,
    expectedConfiguration: original,
  });
  await f.restart();
  await f.assistant.tick();
  expect((await f.rpc(f.input())).job!.status).toBe("done");
  expect((await f.automations.list())[0]).toMatchObject({
    id: original.id,
    name: "Owner's later name",
    enabled: false,
  });
  expect(await f.automations.list()).toHaveLength(1);
  expect(f.engine.command).not.toHaveBeenCalled();
});

it("recovers a lost acknowledgement from the atomically committed creation receipt without another save", async () => {
  const f = await fixture(),
    original = f.automations.withAuthorization.bind(f.automations),
    save = vi.spyOn(f.automations, "save");
  vi.spyOn(f.automations, "withAuthorization").mockImplementationOnce(async (authorized, work) => {
    await original(authorized, work);
    throw new Error("Response lost after actual transaction commit");
  });
  const result = (await f.rpc(f.input())).job!;
  expect(result.status).toBe("done");
  expect(save).toHaveBeenCalledTimes(1);
  await f.restart();
  await f.assistant.tick();
  expect((await f.rpc(f.input())).job!.id).toBe(result.id);
  expect(await f.automations.list()).toHaveLength(1);
});

it("does not recreate a separately deleted automation or delete it when its creation job is removed", async () => {
  const f = await fixture(),
    first = (await f.rpc(f.input())).job!,
    created = (await f.automations.list())[0];
  await f.rpc({
    op: "jobs.control",
    id: first.id,
    expectedVersion: first.version,
    action: "delete",
  });
  expect((await f.automations.list())[0].id).toBe(created.id);
  const second = (await f.rpc(f.input("second-owner-reviewed-creation"))).job!,
    secondId = second.kind === "quick" ? second.quickResult?.automationId : undefined;
  await f.automations.delete(secondId!);
  await f.restart();
  await f.assistant.tick();
  expect((await f.rpc(f.input("second-owner-reviewed-creation"))).job!.status).toBe("done");
  expect((await f.automations.list()).map((item) => item.id)).toEqual([created.id]);
});

it("never adopts or overwrites a pre-existing owner's automation at its deterministic ID", async () => {
  const f = await fixture(),
    job = standalone("preoccupied-quick-automation", f.action),
    id = assistantQuickAutomationId(job.id);
  await f.automations.save({
    ...assistantQuickAutomationConfiguration(job),
    name: "Existing owner configuration",
    enabled: false,
  });
  const save = vi.spyOn(f.automations, "save"),
    helper = new HostAssistantQuickAutomations(f.store, {
      automations: () => f.automations,
      authorized: async () => true,
    });
  await helper.ready;
  expect((await helper.run(job)).state).toBe("waiting");
  expect((await helper.receipt(job.id))?.state).toBe("conflict");
  expect((await helper.run(job)).state).toBe("waiting");
  expect((await f.automations.list())[0]).toMatchObject({
    id,
    name: "Existing owner configuration",
    enabled: false,
  });
  expect(save).not.toHaveBeenCalled();
});

it("refuses cross-store composition before any automation save", async () => {
  const f = await fixture(),
    other = new HostStore(join(f.folder, "other.db"));
  await other.ready;
  const automations = new HostAutomations(other, f.engine);
  await automations.ready;
  closes.push(async () => {
    await automations.close();
    await other.close();
  });
  const save = vi.spyOn(automations, "save"),
    helper = new HostAssistantQuickAutomations(f.store, {
      automations: () => automations,
      authorized: async () => true,
    });
  await helper.ready;
  expect((await helper.run(standalone("different-store", f.action))).state).toBe("waiting");
  expect(save).not.toHaveBeenCalled();
  expect(await automations.list()).toEqual([]);
});

it("keeps an unknown matching config without an atomic creation receipt waiting instead of adopting or replaying it", async () => {
  const f = await fixture(),
    job = standalone("unknown-no-proof", f.action),
    helper = new HostAssistantQuickAutomations(f.store, {
      automations: () => f.automations,
      authorized: async () => true,
    });
  await helper.ready;
  await f.automations.save(assistantQuickAutomationConfiguration(job));
  await f.store.db.prepare("INSERT INTO assistant_quick_automations(job_id,value) VALUES(?,?)").run(
    job.id,
    JSON.stringify({
      jobId: job.id,
      automationId: assistantQuickAutomationId(job.id),
      fingerprint: assistantQuickAutomationFingerprint(job),
      state: "writing",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      message: "Interrupted before a confirmed receipt",
    }),
  );
  const save = vi.spyOn(f.automations, "save");
  expect((await helper.run(job)).state).toBe("waiting");
  expect(save).not.toHaveBeenCalled();
  expect(await f.automations.list()).toHaveLength(1);
});

it("rolls back actual automation creation when its same-store durable completed receipt cannot commit", async () => {
  const f = await fixture();
  await f.store.db.exec(
    "CREATE TRIGGER reject_quick_proof BEFORE UPDATE OF value ON assistant_quick_automations WHEN json_extract(NEW.value,'$.state')='completed' BEGIN SELECT RAISE(ABORT,'Fixture receipt durability failure'); END",
  );
  const save = vi.spyOn(f.automations, "save"),
    result = (await f.rpc(f.input())).job!;
  expect(result.status).toBe("waiting");
  expect(result.quickIntent?.automationId).toBe(assistantQuickAutomationId(result.id));
  expect(result.quickResult).toBeUndefined();
  expect(save).toHaveBeenCalledTimes(1);
  expect(await f.automations.list()).toEqual([]);
  await f.store.db
    .prepare("UPDATE assistant_jobs SET value=json_remove(value,'$.quickIntent') WHERE id=?")
    .run(result.id);
  expect((await f.rpc({ op: "snapshot" })).snapshot!.jobs[0].quickIntent?.automationId).toBe(
    assistantQuickAutomationId(result.id),
  );
  await f.restart();
  await f.assistant.tick();
  expect((await f.rpc(f.input())).job!.status).toBe("waiting");
  expect(await f.automations.list()).toEqual([]);
});

it("honors Stop before the actual save even while its transaction is waiting", async () => {
  const f = await fixture(),
    entered = Promise.withResolvers<AssistantQuickAutomationJob>(),
    release = gate(),
    original = f.automations.save.bind(f.automations);
  vi.spyOn(f.automations, "save").mockImplementationOnce(async (raw) => {
    entered.resolve(await f.job());
    await release.promise;
    return original(raw);
  });
  const creating = f.rpc(f.input()),
    running = await entered.promise,
    stopping = f.rpc({
      op: "jobs.control",
      id: running.id,
      expectedVersion: running.version,
      action: "stop",
    });
  await vi.waitFor(() => expect(f.ports.onJobPause).toHaveBeenCalledWith(running.id));
  release.resolve();
  await creating;
  expect((await stopping).job!.status).toBe("cancelled");
  expect(await f.automations.list()).toEqual([]);
  expect(f.engine.command).not.toHaveBeenCalled();
});

it("retains the actual creation receipt after admitted commit while Stop affects only the job, not the independent automation", async () => {
  const f = await fixture(),
    committed = gate(),
    release = gate(),
    original = f.automations.withAuthorization.bind(f.automations);
  vi.spyOn(f.automations, "withAuthorization").mockImplementationOnce(async (authorized, work) => {
    const value = await original(authorized, work);
    committed.resolve();
    await release.promise;
    return value;
  });
  const creating = f.rpc(f.input());
  await committed.promise;
  const running = await f.job(),
    stopping = f.rpc({
      op: "jobs.control",
      id: running.id,
      expectedVersion: running.version,
      action: "stop",
    });
  await vi.waitFor(() => expect(f.ports.onJobPause).toHaveBeenCalledWith(running.id));
  release.resolve();
  await creating;
  const stopped = (await stopping).job!;
  expect(stopped.status).toBe("cancelled");
  expect(stopped.kind === "quick" && stopped.quickResult?.automationId).toBe(
    assistantQuickAutomationId(stopped.id),
  );
  expect((await f.automations.list())[0].enabled).toBe(true);
  expect(await f.automations.runs(assistantQuickAutomationId(stopped.id))).toEqual([]);
});

it("preserves the captured authenticated caller guard inside canonical automation authorization", async () => {
  const f = await fixture(),
    entered = gate(),
    release = gate(),
    original = f.automations.save.bind(f.automations);
  vi.spyOn(f.automations, "save").mockImplementationOnce(async (raw) => {
    entered.resolve();
    await release.promise;
    return original(raw);
  });
  const creating = f.rpc(f.input());
  await entered.promise;
  f.setOwnerAllowed(false);
  release.resolve();
  await expect(creating).rejects.toThrow();
  expect(await f.automations.list()).toEqual([]);
  f.setOwnerAllowed(true);
  await f.assistant.tick();
  expect((await f.rpc(f.input())).job!.status).toBe("waiting");
  expect(await f.automations.list()).toEqual([]);
});
