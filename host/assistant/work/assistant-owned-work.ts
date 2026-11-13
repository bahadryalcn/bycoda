import type { HostStore } from "../../store";
import type { HostTask } from "../../../src/features/tasks/model/hostTasks";
import type { AssistantProfile } from "../../../src/shared/model/host-contracts/assistant";
import { assistantProjectMutationAllowed } from "../management/assistant-permissions";
import type { HostTasks } from "../../tasks/tasks";
import type { HostGoals } from "../../goals/goals";
import type { HostAutomations } from "../../automations/automations";
import { createHash } from "node:crypto";

type Origin = {
  kind: "task" | "goal" | "automation";
  id: string;
  projectId: string;
  threadId: string;
  state: "pending" | "completed";
  entityCreatedAt?: number;
};

/** Only the native-reviewed Crew factory invokes this hook around its canonical Task save. */
export async function recordAssistantCrewTaskOrigin(
  store: HostStore,
  origin: Origin,
): Promise<void> {
  const key = `voice-work:crew-task:${createHash("sha256")
    .update(JSON.stringify([origin.threadId, origin.projectId, origin.id]))
    .digest("hex")}`;
  await store.transaction(async () => {
    const row = await store.db.prepare("SELECT value FROM metadata WHERE key=?").get(key);
    const previous = row ? (JSON.parse(String(row.value)).ownership as Origin) : undefined;
    if (
      previous &&
      (previous.projectId !== origin.projectId ||
        previous.threadId !== origin.threadId ||
        previous.id !== origin.id ||
        (previous.entityCreatedAt !== undefined &&
          previous.entityCreatedAt !== origin.entityCreatedAt))
    )
      throw new Error("Assistant Crew Task ownership changed.");
    await store.db
      .prepare(
        "INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, JSON.stringify({ ownership: origin }));
  }, "critical");
}

/** Saved by the validated Room owner immediately before the exact creation effect. */
async function origins(store: HostStore): Promise<Origin[]> {
  const rows = await store.db
    .prepare(
      "SELECT json_extract(value,'$.ownership') AS origin FROM metadata WHERE key LIKE 'voice-work:%' AND json_extract(value,'$.ownership') IS NOT NULL",
    )
    .all();
  const result = rows.map((row) => JSON.parse(String(row.origin)) as Origin);
  const quickTable = await store.db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='assistant_quick_automations'",
    )
    .get();
  if (quickTable) {
    const quick = await store.db
      .prepare(
        "SELECT q.value AS receipt,j.value AS job FROM assistant_quick_automations q JOIN assistant_jobs j ON j.id=q.job_id WHERE j.deleted_at IS NULL AND json_extract(q.value,'$.state')='completed'",
      )
      .all();
    for (const row of quick) {
      const receipt = JSON.parse(String(row.receipt)) as {
        automationId: string;
        automationCreatedAt?: number;
      };
      const job = JSON.parse(String(row.job)) as { id: string; projectId?: string };
      if (job.projectId && typeof receipt.automationCreatedAt === "number")
        result.push({
          kind: "automation",
          id: receipt.automationId,
          projectId: job.projectId,
          threadId: job.id,
          state: "completed",
          entityCreatedAt: receipt.automationCreatedAt,
        });
    }
  }
  return result;
}
export async function assistantOwnedTaskAllowed(
  store: HostStore,
  task: HostTask,
  profile: AssistantProfile,
  paused: boolean,
): Promise<boolean> {
  const rows = await origins(store);
  let origin = rows.find(
    (origin) =>
      (origin.kind === "task" && origin.id === task.id) ||
      (origin.kind === "goal" && origin.id === task.goalId) ||
      (origin.kind === "automation" &&
        task.source === "automation" &&
        origin.id === task.automationId),
  );
  if (!origin && task.crewRunId) {
    const row = await store.db
      .prepare("SELECT payload FROM crew_runs_v2 WHERE run_id=? AND project_id=? LIMIT 1")
      .get(task.crewRunId, task.projectId);
    const run = row
      ? (JSON.parse(String(row.payload)) as {
          sourceTaskId?: string;
          assignments: { taskId: string }[];
        })
      : undefined;
    if (run?.sourceTaskId && run.assignments.some((assignment) => assignment.taskId === task.id)) {
      const rootRow = await store.db
        .prepare("SELECT value FROM tasks WHERE id=?")
        .get(run.sourceTaskId);
      const root = rootRow ? (JSON.parse(String(rootRow.value)) as HostTask) : undefined;
      const candidate = rows.find(
        (origin) => origin.kind === "task" && origin.id === run.sourceTaskId,
      );
      if (candidate) {
        if (
          !root ||
          root.projectId !== task.projectId ||
          root.createdAt !== candidate.entityCreatedAt ||
          root.crewExecutionId !== task.crewRunId
        )
          return false;
        origin = candidate;
      }
    }
  }
  if (!origin) return true;
  if (origin.state !== "completed" || origin.projectId !== task.projectId || paused) return false;
  if (origin.kind === "task" && origin.id === task.id && origin.entityCreatedAt !== task.createdAt)
    return false;
  if (origin.kind !== "task") {
    const table = origin.kind === "goal" ? "goals" : "automations";
    const row = await store.db.prepare(`SELECT value FROM ${table} WHERE id=?`).get(origin.id);
    const entity = row ? (JSON.parse(String(row.value)) as { createdAt?: number }) : undefined;
    if (!entity || entity.createdAt !== origin.entityCreatedAt) return false;
  }
  if (origin.kind === "automation") {
    const row = await store.db
      .prepare("SELECT value FROM automation_runs WHERE id=? AND automation_id=?")
      .get(task.automationRunId ?? "", origin.id);
    const run = row ? (JSON.parse(String(row.value)) as { taskId?: string }) : undefined;
    if (run?.taskId !== task.id) return false;
  }
  return (
    profile.enabled &&
    profile.setupComplete &&
    assistantProjectMutationAllowed(profile, [task.projectId])
  );
}

export async function assistantOwnedSessionAllowed(
  store: HostStore,
  sessionId: string,
  profile: AssistantProfile,
  paused: boolean,
): Promise<boolean> {
  const taskRows = await store.db
    .prepare(
      "SELECT value FROM tasks WHERE json_extract(value,'$.sessionId')=? OR json_extract(value,'$.reviewer.sessionId')=?",
    )
    .all(sessionId, sessionId);
  for (const row of taskRows)
    if (
      !(await assistantOwnedTaskAllowed(
        store,
        JSON.parse(String(row.value)) as HostTask,
        profile,
        paused,
      ))
    )
      return false;
  const crewTable = await store.db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='crew_runs_v2'")
    .get();
  if (crewTable) {
    const rows = await store.db
      .prepare(
        "SELECT payload FROM crew_runs_v2 WHERE coordinator_session_id=? AND status<>'finished'",
      )
      .all(sessionId);
    for (const row of rows) {
      const run = JSON.parse(String(row.payload)) as {
        id: string;
        projectId: string;
        sourceTaskId?: string;
      };
      if (!run.sourceTaskId) continue;
      const rootRow = await store.db
        .prepare("SELECT value FROM tasks WHERE id=?")
        .get(run.sourceTaskId);
      const root = rootRow ? (JSON.parse(String(rootRow.value)) as HostTask) : undefined;
      const owned = (await origins(store)).some(
        (origin) => origin.kind === "task" && origin.id === run.sourceTaskId,
      );
      if (
        owned &&
        (!root ||
          root.projectId !== run.projectId ||
          root.crewExecutionId !== run.id ||
          !(await assistantOwnedTaskAllowed(store, root, profile, paused)))
      )
        return false;
    }
  }
  return true;
}

export async function assistantOwnedGoalAllowed(
  store: HostStore,
  goalId: string,
  profile: AssistantProfile,
  paused: boolean,
): Promise<boolean> {
  const origin = (await origins(store)).find(
    (origin) => origin.kind === "goal" && origin.id === goalId,
  );
  if (!origin) return true;
  if (origin.state !== "completed" || paused || !profile.enabled || !profile.setupComplete)
    return false;
  const row = await store.db.prepare("SELECT value FROM goals WHERE id=?").get(goalId);
  const goal = row
    ? (JSON.parse(String(row.value)) as { createdAt: number; projectIds: string[] })
    : undefined;
  return (
    !!goal &&
    goal.createdAt === origin.entityCreatedAt &&
    goal.projectIds.every((id) => id === origin.projectId) &&
    assistantProjectMutationAllowed(profile, goal.projectIds)
  );
}

/** Owner Stop controls only exact canonical entities with retained creation receipts. Schedules stay saved. */
export async function stopAssistantOwnedWork(
  store: HostStore,
  tasks: HostTasks,
  goals: HostGoals,
  automations: HostAutomations,
): Promise<void> {
  const errors: unknown[] = [];
  const owned = (await origins(store)).filter((origin) => origin.state === "completed");
  for (const origin of owned) {
    try {
      if (origin.kind === "task") {
        const task = await tasks.get(origin.id);
        if (
          !task ||
          task.projectId !== origin.projectId ||
          task.createdAt !== origin.entityCreatedAt
        )
          continue;
        if (["queued", "running", "verifying"].includes(task.status))
          await tasks.move(task.id, "blocked");
      } else if (origin.kind === "goal") {
        const goal = (await goals.list()).find((goal) => goal.id === origin.id);
        if (
          !goal ||
          goal.createdAt !== origin.entityCreatedAt ||
          goal.projectIds.some((id) => id !== origin.projectId)
        )
          continue;
        if (!["done", "cancelled"].includes(goal.status)) await goals.cancel(goal.id);
      } else {
        const automation = (await automations.list()).find(
          (automation) => automation.id === origin.id,
        );
        if (
          !automation ||
          automation.projectId !== origin.projectId ||
          automation.createdAt !== origin.entityCreatedAt
        )
          continue;
        for (const run of await automations.runs(automation.id))
          if (["pending", "running"].includes(run.status))
            await automations.stopRun(automation.id, run.id);
      }
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new Error(
      `Assistant-owned work stop is incomplete (${errors.length}); inspect the original work.`,
    );
}
