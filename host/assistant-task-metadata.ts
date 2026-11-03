import type { HostStore } from "./store";
import type { HostTask } from "../src/features/tasks/model/hostTasks";
import type { AssistantJob } from "../src/shared/model/host-contracts/assistant";
import type { HostGoal } from "../src/features/tasks/model/hostGoals";
import { assistantJobProjectIds } from "../src/shared/model/assistantProjects";
import { assertAssistantGoalProjects } from "./assistant-job-scope";

/** Only attribution dependencies participate; token/summary updates do not evict it. */
export async function assistantTaskMetadataSourceStamp(
  store: HostStore,
  tasks: HostTask[],
): Promise<string> {
  const ids = [
    ...new Set(
      tasks.flatMap((task) =>
        task.goalId?.startsWith("assistant-") && task.sessionId
          ? [task.goalId.slice("assistant-".length)]
          : [],
      ),
    ),
  ];
  if (!ids.length) return "none";
  const tables = await store.db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('assistant_jobs','goals') ORDER BY name",
    )
    .all();
  if (tables.length !== 2) return "unavailable";
  const jobs = await store.db
    .prepare(
      "SELECT id,deleted_at,json_array(json_extract(value,'$.kind'),json_extract(value,'$.goalId'),json_extract(value,'$.projectId'),json_extract(value,'$.projectIds'),json_extract(value,'$.taskIds'),json_extract(value,'$.sessionIds')) AS scope FROM assistant_jobs WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id",
    )
    .all(JSON.stringify(ids));
  const goals = await store.db
    .prepare(
      "SELECT id,json_array(json_extract(value,'$.leadProjectId'),json_extract(value,'$.projectIds'),json_extract(value,'$.taskIds')) AS scope FROM goals WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id",
    )
    .all(JSON.stringify(ids.map((id) => `assistant-${id}`)));
  return JSON.stringify([jobs, goals]);
}

/** Read-only projection. Reserved attempts and unknown delivery are never counted as delivered. */
export async function withAssistantTaskMetadata(
  store: HostStore,
  tasks: HostTask[],
): Promise<HostTask[]> {
  tasks = tasks.some((task) => task.assistantFollowups !== undefined)
    ? tasks.map((task) => {
        const { assistantFollowups: _, ...canonical } = task;
        return canonical;
      })
    : tasks;
  const candidates = tasks.filter(
    (task) => task.goalId?.startsWith("assistant-") && task.sessionId,
  );
  if (!candidates.length) return tasks;
  const tables = await store.db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('assistant_jobs','assistant_session_receipts','goals')",
    )
    .all();
  if (tables.length !== 3) return tasks;
  const jobIds = [...new Set(candidates.map((task) => task.goalId!.slice("assistant-".length)))];
  const jobs = new Map(
    (
      await store.db
        .prepare(
          "SELECT value FROM assistant_jobs WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))",
        )
        .all(JSON.stringify(jobIds))
    ).map((row) => {
      const job = JSON.parse(row.value) as AssistantJob;
      return [job.id, job];
    }),
  );
  const goals = new Map(
    (
      await store.db
        .prepare("SELECT value FROM goals WHERE id IN (SELECT value FROM json_each(?))")
        .all(JSON.stringify(candidates.map((task) => task.goalId)))
    ).map((row) => {
      const goal = JSON.parse(row.value) as HostGoal;
      return [goal.id, goal];
    }),
  );
  const targets = candidates.flatMap((task) => {
    const job = jobs.get(task.goalId!.slice("assistant-".length)),
      goal = goals.get(task.goalId!);
    if (
      !job ||
      job.kind === "quick" ||
      !goal ||
      !Array.isArray(goal.taskIds) ||
      !Array.isArray(job.taskIds) ||
      !Array.isArray(job.sessionIds) ||
      !goal.taskIds.includes(task.id) ||
      !job.taskIds.includes(task.id) ||
      !job.sessionIds.includes(task.sessionId!) ||
      !assistantJobProjectIds(job).includes(task.projectId)
    )
      return [];
    try {
      assertAssistantGoalProjects(job, goal);
    } catch {
      return [];
    }
    return [{ taskId: task.id, jobId: job.id, sessionId: task.sessionId! }];
  });
  if (!targets.length) return tasks;
  const rows = await store.db
    .prepare(`WITH targets AS (SELECT json_extract(value,'$.taskId') task_id,json_extract(value,'$.jobId') job_id,json_extract(value,'$.sessionId') session_id FROM json_each(?))
 SELECT t.task_id,
 SUM(CASE WHEN json_extract(r.value,'$.operation.state')='settled' AND json_extract(r.value,'$.operation.delivery')='delivered' THEN 1 ELSE 0 END) delivered,
 SUM(CASE WHEN json_extract(r.value,'$.operation.delivery')='unknown' THEN 1 ELSE 0 END) unconfirmed
 FROM targets t JOIN assistant_session_receipts r
 ON r.id>=t.job_id||':'||t.session_id||':' AND r.id<t.job_id||':'||t.session_id||';'
 AND json_extract(r.value,'$.operation.sessionId')=t.session_id
 WHERE json_extract(r.value,'$.operation.action')='send' GROUP BY t.task_id`)
    .all(JSON.stringify(targets));
  const counts = new Map(
    rows.map((row) => [
      String(row.task_id),
      { delivered: Number(row.delivered), unconfirmed: Number(row.unconfirmed) },
    ]),
  );
  return tasks.map((task) => {
    const count = counts.get(task.id);
    return count && (count.delivered || count.unconfirmed)
      ? { ...task, assistantFollowups: count }
      : task;
  });
}
