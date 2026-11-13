import { getSessionWork, assertTaskWorkRetired } from "../work/session-adapter";
import type { HostStore } from "../store";
import type { HostTasks } from "../tasks/service";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import { STOPPED_BY_USER } from "../sessions/sessionRuns";
import type {
  HostAutomation,
  HostAutomationRun,
} from "../../src/features/automations/model/hostAutomations";

/** Task and occurrence link commit together. Replays never edit/requeue a Task. */
export async function createAutomationTask(
  store: HostStore,
  tasks: HostTasks,
  automation: HostAutomation,
  run: HostAutomationRun,
): Promise<HostAutomationRun> {
  await tasks.ready;
  return store.transaction(async () => {
    const row = await store.db
      .prepare("SELECT value FROM automation_runs WHERE id=? AND automation_id=?")
      .get(run.id, automation.id);
    if (!row) throw new Error("Automation occurrence no longer exists.");
    const current = JSON.parse(String(row.value)) as HostAutomationRun;
    if (current.taskId || current.status !== "pending") return current;
    const mapping = await store.db
      .prepare("SELECT task_id FROM automation_tasks WHERE run_id=?")
      .get(run.id);
    if (mapping) throw new Error("Automation Task link exists without its occurrence receipt.");
    const taskId = `automation-${run.id}`;
    if (await tasks.get(taskId)) throw new Error("Automation Task identity is already occupied.");
    await tasks.save({
      id: taskId,
      source: "automation",
      automationId: automation.id,
      automationRunId: run.id,
      expectedAbsent: true,
      projectId: automation.projectId,
      title: automation.name,
      prompt: automation.prompt,
      harness: automation.harness,
      providerAccountId: automation.providerAccountId,
      model: automation.model,
      modelSettings: automation.modelSettings,
      runtimeMode: automation.runtimeMode,
      maxRunMinutes: run.maxRunMinutes ?? automation.maxRunMinutes,
      isolate: automation.isolate,
      review: false,
      autoMerge: false,
    });
    await store.db
      .prepare("INSERT INTO automation_tasks(run_id,automation_id,task_id) VALUES(?,?,?)")
      .run(run.id, automation.id, taskId);
    const linked = { ...current, taskId };
    await store.db
      .prepare("UPDATE automation_runs SET value=? WHERE id=? AND value=?")
      .run(JSON.stringify(linked), run.id, String(row.value));
    return linked;
  });
}

/** Review is still owner work. Report success only once canonical Task is done. */
export function automationTaskProjection(
  run: HostAutomationRun,
  task: HostTask,
  waitingForInput = false,
): Partial<HostAutomationRun> & Pick<HostAutomationRun, "status"> {
  const status =
    task.status === "done"
      ? "succeeded"
      : task.status === "blocked"
        ? run.cancellationRequested
          ? "cancelled"
          : "failed"
        : task.status === "queued" || task.status === "todo"
          ? "pending"
          : "running";
  return {
    status,
    sessionId: task.sessionId,
    runId: task.runId,
    startedAt: task.startedAt ?? run.startedAt,
    error: task.error,
    needsInput:
      task.status === "review" || (task.status === "running" && waitingForInput) || undefined,
  };
}

/** Durable mapping, not a caller-supplied taskId, grants producer stop ownership. */
export async function assertAutomationTaskOwnership(
  store: HostStore,
  run: HostAutomationRun,
  task: HostTask,
): Promise<void> {
  const mapping = await store.db
    .prepare("SELECT task_id,automation_id FROM automation_tasks WHERE run_id=?")
    .get(run.id);
  if (
    !mapping ||
    mapping.task_id !== task.id ||
    mapping.automation_id !== run.automationId ||
    run.taskId !== task.id ||
    task.source !== "automation" ||
    task.automationId !== run.automationId ||
    task.automationRunId !== run.id
  )
    throw new Error("Automation Task ownership does not match this occurrence.");
}

/** A retained to-do item is not restarted or completed as a side effect of Stop. */
export async function assertUnstartedAutomationTaskRetired(
  store: HostStore,
  task: HostTask,
): Promise<void> {
  if (
    task.status !== "todo" ||
    task.sessionId ||
    task.runId ||
    task.startedAt !== undefined ||
    task.branch ||
    task.workspaceId ||
    task.worktreeCwd
  )
    throw new Error(
      "Automation Task is not proven unstarted. Read its current state before stopping.",
    );
  const runtime = getSessionWork(store);
  if (!runtime)
    throw new Error("Shared Work admission is unavailable; Task retirement is unknown.");
  await assertTaskWorkRetired(store, task.id);
  const records = (await runtime.list()).filter(
    (work) =>
      work.source.id === task.id &&
      (work.source.kind.startsWith("task.") || work.source.kind === "crew.member"),
  );
  if (records.some((work) => work.state !== "completed" || work.reserved))
    throw new Error("The previous task execution is not proven stopped. Retry after it retires.");
}

/** Stop the canonical Task, then prove every exact Work occurrence retired. */
export async function stopAutomationTask(
  store: HostStore,
  tasks: HostTasks,
  task: HostTask,
): Promise<void> {
  await tasks.cancel(task.id, STOPPED_BY_USER);
  const runtime = getSessionWork(store);
  if (!runtime)
    throw new Error("Shared Work admission is unavailable; Task retirement is unknown.");
  for (const work of await runtime.list()) {
    if (
      work.source.id === task.id &&
      (work.source.kind.startsWith("task.") || work.source.kind === "crew.member")
    )
      await runtime.stop(work.id);
  }
  await assertTaskWorkRetired(store, task.id);
}
