import { expect, it, vi } from "vitest";
import { ConversationThreadWorkTools } from "./conversation-thread-work-tools";
import type { HostStore } from "../store";
import type { HostTasks } from "../tasks";
import type { HostGoals } from "../goals";
import type { HostAutomations } from "../automations";
import type { RuntimeLogSubjectPrincipal } from "../runtime-log-tools";

function fixture() {
  const receipts = new Map<string, string>();
  let records: Array<Record<string, unknown>> = [];
  const store = {
    project: vi.fn(async () => ({ id: "p", cwd: "/repo" })),
    db: {
      prepare: (sql: string) => ({
        get: async (key: string) => (receipts.has(key) ? { value: receipts.get(key) } : undefined),
        run: async (one: string, two: string) => {
          if (sql.startsWith("INSERT")) {
            if (receipts.has(one)) return { changes: 0 };
            receipts.set(one, two);
          } else receipts.set(two, one);
          return { changes: 1 };
        },
      }),
    },
  } as unknown as HostStore;
  const tasks = {
    list: vi.fn(async () => records),
    save: vi.fn(async (input) => {
      const task = { ...input, updatedAt: 2 };
      records.push(task);
      return task;
    }),
    startTask: vi.fn(async () => ({ status: "running" })),
    move: vi.fn(),
  };
  const goals = {
    list: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
    create: vi.fn(),
    update: vi.fn(),
    replan: vi.fn(),
    cancel: vi.fn(),
    delete: vi.fn(),
  };
  const automations = {
    list: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
    save: vi.fn(),
    delete: vi.fn(),
    runs: vi.fn(),
    runNow: vi.fn(),
    stopRun: vi.fn(),
  };
  const approve = vi.fn(async (operation: { operationHash: string }) => ({
    approved: true,
    operationHash: operation.operationHash,
  }));
  const service = () =>
    new ConversationThreadWorkTools(
      store,
      tasks as unknown as HostTasks,
      goals as unknown as HostGoals,
      automations as unknown as HostAutomations,
      approve,
    );
  const principal = {
    kind: "assistant-thread",
    threadId: "thread",
    projectId: "p",
    environmentId: "env",
  } as RuntimeLogSubjectPrincipal;
  const authorized = vi.fn(async () => true);
  return {
    service,
    principal,
    authorized,
    tasks,
    goals,
    automations,
    approve,
    receipts,
    set records(value: Array<Record<string, unknown>>) {
      records = value;
    },
  };
}
const input = {
  taskId: "task",
  title: "Task",
  prompt: "Do work",
  execution: { harness: "codex", model: "gpt", runtimeMode: "auto", modelSettings: {} },
};
it("creates global work with explicit reviewed execution and deduplicates across service recreation", async () => {
  const f = fixture();
  const result = await f
    .service()
    .call("tasks.create", input, f.principal, f.authorized, "request");
  expect(result).toMatchObject({
    projectId: "p",
    autoMerge: false,
    continueUntilDone: false,
    review: true,
    harness: "codex",
    expectedAbsent: true,
  });
  expect(
    await f.service().call("tasks.create", input, f.principal, f.authorized, "request"),
  ).toEqual(result);
  expect(f.tasks.save).toHaveBeenCalledOnce();
  expect(f.approve).toHaveBeenCalledOnce();
  await expect(
    f
      .service()
      .call("tasks.create", { ...input, prompt: "Changed" }, f.principal, f.authorized, "request"),
  ).rejects.toThrow("reused");
});
it("keeps uncertain effects retained instead of replaying after an acknowledgement is lost", async () => {
  const f = fixture();
  f.tasks.save.mockRejectedValueOnce(new Error("lost acknowledgement"));
  await expect(
    f.service().call("tasks.create", input, f.principal, f.authorized, "request"),
  ).rejects.toThrow("lost acknowledgement");
  expect(
    await f.service().call("tasks.create", input, f.principal, f.authorized, "request"),
  ).toMatchObject({ status: "uncertain", requestId: "request" });
  expect(f.tasks.save).toHaveBeenCalledOnce();
});
it("requires exact native approval and refuses changed state after approval", async () => {
  const f = fixture();
  f.approve.mockResolvedValueOnce({ approved: true, operationHash: "wrong" });
  await expect(
    f.service().call("tasks.create", input, f.principal, f.authorized, "one"),
  ).rejects.toThrow("approval");
  expect(f.tasks.save).not.toHaveBeenCalled();
  f.approve.mockImplementationOnce(async (operation) => {
    f.records = [{ id: "task", projectId: "p", updatedAt: 1 }];
    return { approved: true, operationHash: operation.operationHash };
  });
  await expect(
    f.service().call("tasks.create", input, f.principal, f.authorized, "two"),
  ).rejects.toThrow("changed during approval");
  expect(f.tasks.save).not.toHaveBeenCalled();
});
it("requires explicit execution and current thread authority; hides foreign work", async () => {
  const f = fixture();
  await expect(
    f
      .service()
      .call("tasks.create", { ...input, execution: undefined }, f.principal, f.authorized, "one"),
  ).rejects.toThrow();
  f.authorized.mockResolvedValueOnce(false);
  await expect(f.service().call("tasks.list", {}, f.principal, f.authorized)).rejects.toThrow(
    "revoked",
  );
  f.records = [{ id: "foreign", projectId: "other" }];
  expect(await f.service().call("tasks.list", {}, f.principal, f.authorized)).toMatchObject({
    items: [],
    total: 0,
  });
  await expect(
    f.service().call("tasks.start", { taskId: "foreign" }, f.principal, f.authorized, "two"),
  ).rejects.toThrow("not wholly");
  expect(f.approve).not.toHaveBeenCalled();
});
it("retains reviewed configuration through task and automation canonical saves", async () => {
  const f = fixture();
  const task = { id: "task", projectId: "p", title: "Old", status: "todo", updatedAt: 1 };
  f.records = [task];
  await f
    .service()
    .call("tasks.update", { taskId: "task", title: "New" }, f.principal, f.authorized, "task-edit");
  expect(f.tasks.save).toHaveBeenCalledWith(
    expect.objectContaining({ title: "New", expectedConfiguration: task }),
  );
  const automation = { id: "auto", projectId: "p", name: "Old", updatedAt: 4 };
  f.automations.list.mockResolvedValue([automation]);
  await f
    .service()
    .call("automations.pause", { automationId: "auto" }, f.principal, f.authorized, "auto-edit");
  expect(f.automations.save).toHaveBeenCalledWith(
    expect.objectContaining({ enabled: false, expectedConfiguration: automation }),
  );
  f.automations.list.mockResolvedValue([]);
  await f
    .service()
    .call(
      "automations.create",
      { automationId: "new-auto", execution: input.execution, name: "New", prompt: "Work" },
      f.principal,
      f.authorized,
      "auto-create",
    );
  expect(f.automations.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: "new-auto", expectedAbsent: true }),
  );
});
it("passes the reviewed snapshot into execution admission and valid complete goal settings", async () => {
  const f = fixture();
  const task = { id: "task", projectId: "p", status: "todo", updatedAt: 1 };
  f.records = [task];
  await f.service().call("tasks.start", { taskId: "task" }, f.principal, f.authorized, "start");
  expect(f.tasks.startTask).toHaveBeenCalledWith("task", task);
  const automation = { id: "auto", projectId: "p", updatedAt: 4 };
  f.automations.list.mockResolvedValue([automation]);
  await f
    .service()
    .call("automations.runNow", { automationId: "auto" }, f.principal, f.authorized, "run");
  expect(f.automations.runNow).toHaveBeenCalledWith("auto", automation);
  const goal = {
    id: "goal",
    projectIds: ["p"],
    approvePlan: true,
    manualStart: true,
    updatedAt: 5,
    maxRunningTasks: 2,
    maxRunMinutes: 10,
  };
  f.goals.list.mockResolvedValue([goal]);
  await f
    .service()
    .call(
      "goals.update",
      { goalId: "goal", maxRunMinutes: 20 },
      f.principal,
      f.authorized,
      "goal-edit",
    );
  expect(f.goals.update).toHaveBeenCalledWith(
    "goal",
    expect.objectContaining({
      autoMerge: false,
      continueUntilDone: false,
      maxRunningTasks: 2,
      maxRunMinutes: 20,
    }),
    5,
  );
});

it("uses a distinct delegated principal and rejects stale target revisions", async () => {
  const f=fixture();
  const principal={kind:"delegated-assistant-thread" as const,originEnvironmentId:"origin",targetEnvironmentId:"target",threadId:"thread",projectId:"p",grantId:"grant"};
  const service=f.service();
  expect(await service.callDelegated("tasks.create",input,principal,f.authorized)).toMatchObject({projectId:"p",expectedAbsent:true});
  await expect(service.callDelegated("tasks.update",{taskId:"task",title:"changed",expectedUpdatedAt:1},principal,f.authorized)).rejects.toThrow("Work changed");
  expect(f.tasks.save).toHaveBeenCalledOnce();
});

it("qualifies project state before review and checks scope again before the effect", async () => {
  const f = fixture();
  let captures = 0;
  const result = await f.service().call("tasks.create", input, f.principal, f.authorized, "scope-test", async effect => {
    captures++;
    if (captures === 2) throw new Error("Project became private");
    return effect();
  }).catch(error => error);
  expect(result).toBeInstanceOf(Error);
  expect(result.message).toContain("Project became private");
  expect(f.approve).toHaveBeenCalledOnce();
  expect(f.tasks.save).not.toHaveBeenCalled();
  expect(captures).toBe(2);
});
