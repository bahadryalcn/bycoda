import { mapAsync } from "../async-collections";
import {
  withAssistantTaskMetadata,
  assistantTaskMetadataSourceStamp,
} from "../assistant/work/assistant-task-metadata";
import { createHash, randomUUID } from "node:crypto";
import { mergeQueueAdmission } from "./queue-admission-merge";
import {
  NO_VERDICT,
  parseReviewVerdict,
  type HostTask,
} from "../../src/features/tasks/model/hostTasks";
import {
  addReviewNotes,
  coalesceReviewNotes,
  reviewFindings,
} from "../../src/features/tasks/model/taskReviewNotes";
import type {
  SprintSourceEvent,
  SprintTaskSnapshot,
} from "../../src/features/tasks/model/hostSprints";
import { suspendedTaskDelivery } from "./task-workspace-runtime";
import { reviewerReply } from "./review-outcomes";
import type { TaskContext } from "./context";
export async function revisionCounter(context: TaskContext): Promise<number> {
  return Number(
    (await context.store.db.prepare("SELECT version FROM task_cache_revision WHERE id=1").get())!
      .version,
  );
}

export async function revision(context: TaskContext): Promise<number> {
  await context.ready;

  return await context.store.db.scope(async () => {
    return await context.revisionCounter();
  });
}

export async function assistantFollowupsChanged(context: TaskContext): Promise<void> {
  await context.ready;
  await context.store.transaction(async () => {
    await context.store.db
      .prepare("UPDATE task_cache_revision SET version=version+1 WHERE id=1")
      .run();
    context.store.afterCommit(() => context.onChange?.());
  }, "critical");
}

export async function changeEtag(context: TaskContext): Promise<string> {
  await context.ready;

  return await context.store.db.scope(async () => {
    const revision = await context.revisionCounter();
    if (context.etagCache?.revision === revision && context.etagCache.sourceStamp === "none")
      return context.etagCache.etag;
    const sourceStamp = await assistantTaskMetadataSourceStamp(
      context.store,
      await context.list(undefined, false),
    );
    if (context.etagCache?.revision === revision && context.etagCache.sourceStamp === sourceStamp)
      return context.etagCache.etag;
    const summaries = (await context.list()).map((task) => ({
      id: task.id,
      status: task.status,
      updatedAt: task.updatedAt,
      sessionId: task.sessionId,
      runId: task.runId,
      usageStamp: task.budgetUsage?.measuredAt,
      assistantFollowups: task.assistantFollowups,
      evaluation: task.evaluation,
      error: typeof task.error === "string" ? task.error.slice(0, 512) : undefined,
    }));
    const etag = createHash("sha256").update(JSON.stringify(summaries)).digest("base64url");
    // list() may itself backfill review notes, which bumps the revision.
    if (!context.store.transactionActive)
      context.etagCache = { revision: await context.revisionCounter(), sourceStamp, etag };
    return etag;
  });
}

export async function snapshotWithCursor(context: TaskContext): Promise<{
  tasks: SprintTaskSnapshot[];
  cursor: number;
  historyAvailableFrom: number;
}> {
  await context.ready;
  return context.store.transaction(async () => {
    const rows = await context.store.db
      .prepare(
        "SELECT id, json_extract(value,'$.projectId') AS projectId, json_extract(value,'$.title') AS title, json_extract(value,'$.status') AS status, json_extract(value,'$.updatedAt') AS updatedAt, json_extract(value,'$.goalId') AS goalId FROM tasks ORDER BY id",
      )
      .all();
    const watermark = await context.store.db
      .prepare("SELECT coalesce(max(sequence),0) AS cursor FROM task_history")
      .get();
    const meta = await context.store.db
      .prepare("SELECT available_from FROM task_history_meta WHERE id=1")
      .get();
    return {
      tasks: rows.map(({ goalId, ...task }) => ({
        ...task,
        ...(typeof goalId === "string" ? { goalId } : {}),
      })) as SprintTaskSnapshot[],
      cursor: Number(watermark!.cursor),
      historyAvailableFrom: Number(meta!.available_from),
    };
  });
}

export async function events(
  context: TaskContext,
  after: number,
  limit = 500,
): Promise<{
  events: SprintSourceEvent[];
  cursor: number;
  hasMore: boolean;
  historyAvailableFrom: number;
  gap?: boolean;
}> {
  await context.ready;
  if (!Number.isSafeInteger(after) || after < 0) throw new Error("Invalid task history cursor.");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new Error("Task history page size must be between 1 and 1000.");
  return context.store.transaction(async () => {
    const floor = await context.store.db
      .prepare("SELECT sequence FROM task_history_floor WHERE id=1")
      .get();
    const watermark = await context.store.db
      .prepare("SELECT coalesce(max(sequence),0) AS cursor FROM task_history")
      .get();
    if (after > Number(watermark!.cursor))
      throw new Error(
        "Task history cursor is ahead of this source. Reconnect the original environment.",
      );
    if (after < Number(floor!.sequence)) {
      const meta = await context.store.db
        .prepare("SELECT available_from FROM task_history_meta WHERE id=1")
        .get();
      return {
        events: [],
        cursor: after,
        hasMore: false,
        historyAvailableFrom: Number(meta!.available_from),
        gap: true,
      };
    }
    const rows = await context.store.db
      .prepare("SELECT * FROM task_history WHERE sequence>? ORDER BY sequence LIMIT ?")
      .all(after, limit + 1);
    const events: SprintSourceEvent[] = rows.slice(0, limit).map((row) => ({
      sequence: Number(row.sequence),
      projectId: String(row.project_id),
      taskId: String(row.task_id),
      status: row.status,
      effectiveAt: Number(row.effective_at),
      deleted: row.deleted === 1,
      task: (() => {
        const task = JSON.parse(String(row.task));
        if (task.goalId === null) delete task.goalId;
        return task as SprintTaskSnapshot;
      })(),
    }));
    const meta = await context.store.db
      .prepare("SELECT available_from FROM task_history_meta WHERE id=1")
      .get();
    return {
      events,
      cursor: events.at(-1)?.sequence ?? after,
      hasMore: rows.length > limit,
      historyAvailableFrom: Number(meta!.available_from),
    };
  });
}

export async function list(
  context: TaskContext,
  projectId?: string,
  includeAssistantMetadata = true,
): Promise<HostTask[]> {
  await context.ready;

  const entryRevision = await context.store.db.scope(() => context.revisionCounter());
  const result = await context.store.db.scope(async () => {
    if (projectId !== undefined) {
      const cached = context.projectListCache.get(projectId);
      if (cached?.revision === (await context.revisionCounter())) return cached.tasks.slice();
      const tasks = (
        await mapAsync(
          await context.store.db
            .prepare("SELECT value FROM tasks WHERE json_extract(value, '$.projectId')=?")
            .all(projectId),
          async (row) => await context.withReviewNotes(JSON.parse(String(row.value)) as HostTask),
        )
      ).sort((a, b) => a.createdAt - b.createdAt);
      if (context.projectListCache.size >= 32) context.projectListCache.clear();
      if (!context.store.transactionActive)
        context.projectListCache.set(projectId, {
          revision: await context.revisionCounter(),
          tasks,
        });
      return tasks.slice();
    }
    if (context.listCache?.revision === (await context.revisionCounter()))
      return context.listCache.tasks.slice();
    const tasks = (
      await mapAsync(
        (await context.store.db.prepare("SELECT value FROM tasks").all()).map(
          (row) => JSON.parse(String(row.value)) as HostTask,
        ),
        async (task) => await context.withReviewNotes(task),
      )
    ).sort((a, b) => a.createdAt - b.createdAt);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    // Review-note backfills above can themselves bump the revision.
    if (!context.store.transactionActive)
      context.listCache = { revision: await context.revisionCounter(), byId, tasks };
    return tasks.slice();
  });
  if (!includeAssistantMetadata || context.store.transactionActive) return result;
  const revision = await context.store.db.scope(() => context.revisionCounter());
  const sourceStamp = await assistantTaskMetadataSourceStamp(context.store, result);
  const metadata = context.assistantMetadataCache.get(projectId);
  if (
    entryRevision === revision &&
    metadata?.revision === revision &&
    metadata.sourceStamp === sourceStamp
  )
    return metadata.tasks.slice();
  const projected = await withAssistantTaskMetadata(context.store, result);
  if (
    !context.store.transactionActive &&
    entryRevision === revision &&
    revision === (await context.store.db.scope(() => context.revisionCounter())) &&
    sourceStamp === (await assistantTaskMetadataSourceStamp(context.store, result))
  ) {
    if (context.assistantMetadataCache.size >= 32) context.assistantMetadataCache.clear();
    context.assistantMetadataCache.set(projectId, { revision, sourceStamp, tasks: projected });
  }
  return projected.slice();
}

export async function taskIndex(
  context: TaskContext,
  ids?: readonly string[],
): Promise<ReadonlyMap<string, HostTask>> {
  await context.ready;

  return await context.store.db.scope(async () => {
    if (ids) {
      const revision = await context.revisionCounter();
      if (!context.store.transactionActive && context.pointIndex?.revision !== revision)
        context.pointIndex = { revision, entries: new Map(), bytes: 0 };
      const cache = context.store.transactionActive
        ? {
            revision,
            entries: new Map<
              string,
              {
                value?: HostTask;
                bytes: number;
              }
            >(),
            bytes: 0,
          }
        : context.pointIndex!;
      const result = new Map<string, HostTask>();
      for (const id of ids) {
        let value = context.schedulerTasks?.get(id);
        if (!value) {
          let cached = cache.entries.get(id);
          if (!cached) {
            const row = await context.store.db
              .prepare("SELECT value FROM tasks WHERE id=?")
              .get(id);
            const raw = row ? String(row.value) : undefined;
            value =
              raw === undefined
                ? undefined
                : await context.withReviewNotes(JSON.parse(raw) as HostTask);
            // A legacy review-note backfill can itself write a task.
            const current = await context.revisionCounter();
            if (cache.revision !== current) {
              cache.entries.clear();
              cache.bytes = 0;
              cache.revision = current;
            }
            cached = { value, bytes: raw === undefined ? 64 : Buffer.byteLength(raw) + 64 };
            cache.entries.set(id, cached);
            cache.bytes += cached.bytes;
            while (cache.entries.size > 256 || cache.bytes > 16 * 1024 * 1024) {
              const first = cache.entries.keys().next().value;
              if (first === undefined) break;
              cache.bytes -= cache.entries.get(first)!.bytes;
              cache.entries.delete(first);
            }
          }
          value = cached.value;
        }
        if (value) result.set(id, value);
      }
      return result;
    }
    if (context.schedulerTasks) return context.schedulerTasks;
    if (context.store.transactionActive)
      return new Map((await context.list()).map((task) => [task.id, task]));
    if (context.listCache?.revision !== (await context.revisionCounter())) await context.list();
    return context.listCache!.byId;
  });
}

export async function transaction<T>(
  context: TaskContext,
  operation: () => T | Promise<T>,
): Promise<T> {
  await context.ready;

  const pass = context.schedulerTasks;
  const before = pass ? new Map(pass) : undefined;
  try {
    return await context.store.transaction(operation);
  } catch (error) {
    context.listCache = undefined;
    context.projectListCache.clear();
    if (pass && before) {
      pass.clear();
      for (const [id, task] of before) pass.set(id, task);
    }
    throw error;
  }
}

export async function get(context: TaskContext, id: string): Promise<HostTask | undefined> {
  await context.ready;

  return await context.store.db.scope(async () => {
    return await context.find(id);
  });
}

export async function find(context: TaskContext, id: string): Promise<HostTask | undefined> {
  const value = await context.taskValue(id);
  return value === undefined
    ? undefined
    : await context.withReviewNotes(JSON.parse(value) as HostTask);
}

export async function taskValue(context: TaskContext, id: string): Promise<string | undefined> {
  const row = await context.store.db.prepare("SELECT value FROM tasks WHERE id=?").get(id);
  return row ? String(row.value) : undefined;
}

export async function unchangedTask(
  context: TaskContext,
  id: string,
  expected: string | undefined,
): Promise<HostTask | undefined> {
  const value = await context.taskValue(id);
  return expected !== undefined && value === expected
    ? await context.withReviewNotes(JSON.parse(value) as HostTask)
    : undefined;
}

export async function hydrateDependencies(
  context: TaskContext,
  graph: Map<string, HostTask>,
  roots: Iterable<Pick<HostTask, "id" | "dependsOn">>,
): Promise<void> {
  const queue = [...roots];
  const visited = new Set<string>();
  for (let index = 0; index < queue.length; index++) {
    const task = queue[index];
    if (visited.has(task.id)) continue;
    visited.add(task.id);
    for (const id of task.dependsOn ?? []) {
      const dependency = graph.get(id) ?? (await context.find(id));
      if (!dependency) continue;
      graph.set(id, dependency);
      queue.push(dependency);
    }
  }
}

export async function scheduledTask(
  context: TaskContext,
  id: string,
): Promise<HostTask | undefined> {
  const known = context.schedulerTasks?.get(id);
  if (known) return known;
  const value = await context.find(id);
  if (value && context.schedulerTasks) {
    context.schedulerTasks.set(id, value);
    await context.hydrateDependencies(context.schedulerTasks, [value]);
  }
  return value;
}

export async function schedulerSnapshot(
  context: TaskContext,
  dependencies = true,
  persisted?: Map<string, string>,
): Promise<Map<string, HostTask>> {
  return await context.store.db.scope(async () => {
    const rows = await context.store.db
      .prepare(`
      SELECT value FROM tasks WHERE json_extract(value, '$.status') IN ('queued','running','verifying','review','blocked')
      UNION ALL SELECT value FROM tasks WHERE json_extract(value, '$.status')='done' AND json_extract(value, '$.merged')=1
        AND (json_extract(value, '$.worktreeCwd') IS NOT NULL OR json_array_length(value, '$.historyRecovery')>0)
    `)
      .all();
    const result = new Map<string, HostTask>();
    const queue = await mapAsync(rows, async (row) => {
      const value = String(row.value);
      const task = await context.withReviewNotes(JSON.parse(value) as HostTask);
      persisted?.set(task.id, value);
      return task;
    });
    for (let index = 0; index < queue.length; index++) {
      const task = queue[index];
      if (result.has(task.id)) continue;
      result.set(task.id, task);
      if (!dependencies) continue;
      for (const id of task.dependsOn ?? []) {
        if (result.has(id)) continue;
        const dependency = await context.find(id);
        if (dependency) queue.push(dependency);
      }
    }
    return result;
  });
}

export function dependencyCycle(
  _context: TaskContext,
  id: string,
  graph: ReadonlyMap<string, Pick<HostTask, "dependsOn">>,
): string[] | undefined {
  const visited = new Set<string>();
  const path: string[] = [];
  const visit = (current: string): string[] | undefined => {
    const index = path.indexOf(current);
    if (index !== -1) return [...path.slice(index), current];
    if (visited.has(current)) return;
    path.push(current);
    for (const dependency of graph.get(current)?.dependsOn ?? []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    path.pop();
    visited.add(current);
  };
  return visit(id);
}

export async function withReviewNotes(context: TaskContext, task: HostTask): Promise<HostTask> {
  if (task.reviewNotes !== undefined) {
    const notes = coalesceReviewNotes(task.reviewNotes);
    return notes.length === task.reviewNotes.length
      ? task
      : await context.write({ ...task, reviewNotes: notes });
  }
  const review = task.verification?.review;
  let notes: HostTask["reviewNotes"] = [];
  if (review) {
    try {
      const session = await context.store.session(review.sessionId);
      const reply = reviewerReply(session.session.blocks);
      const verdict = parseReviewVerdict(reply);
      if (verdict.verdict === review.verdict && verdict.note === review.note)
        notes = addReviewNotes(
          [],
          reviewFindings(reply, review),
          review.sessionId,
          task.completedAt ?? task.updatedAt,
          randomUUID,
        );
    } catch {
      if (
        review.verdict === "fail" &&
        review.note !== NO_VERDICT &&
        task.repairNote === `Review failed: ${review.note}`
      )
        notes = addReviewNotes(
          [],
          reviewFindings("", review),
          undefined,
          task.completedAt ?? task.updatedAt,
          randomUUID,
        );
    }
  } else if (task.repairNote?.startsWith("Review failed: ")) {
    notes = addReviewNotes(
      [],
      [
        {
          finding: task.repairNote.slice("Review failed: ".length),
          kind: "finding",
        },
      ],
      undefined,
      task.updatedAt,
      randomUUID,
    );
  }
  return await context.write({ ...task, reviewNotes: notes });
}

export async function write(
  context: TaskContext,
  task: HostTask,
  persisted?: Map<string, string>,
  reviewed?: HostTask,
  generation?: number,
): Promise<HostTask> {
  const sourceGeneration = task.workspaceGenerationId;
  task = suspendedTaskDelivery(task);
  // An old attempt's diagnostic must never label a new worker/reviewer.
  if (
    task.runStall &&
    (task.status !== "running" ||
      task.error ||
      task.needsInput ||
      task.sessionId !== task.runStall.sessionId ||
      task.runId !== task.runStall.runId)
  )
    task = { ...task, runStall: undefined };
  task = { ...task, workspaceGenerationId: task.workspaceGenerationId ?? randomUUID() };
  const persist = async () => {
    await context.store.db.checkAuthorization();
    if (reviewed) {
      if (
        generation !== undefined &&
        Number(
          (
            await context.store.db
              .prepare("SELECT generation FROM task_admission_generation WHERE id=?")
              .get(task.id)
          )?.generation ?? 0,
        ) !== generation
      )
        throw new Error("Task changed before queue admission. Read it again.");
      task = mergeQueueAdmission(task, reviewed, await context.find(task.id));
    }
    if (context.invalidatedAssistantGenerations.get(task.id)?.has(sourceGeneration))
      throw new Error(
        "The original assistant task execution was retired; stale callbacks cannot restore it.",
      );
    if (task.evaluation && task.status !== "done" && task.status !== "review")
      task = { ...task, evaluation: undefined };
    const run =
      task.status === "running" ? task : task.status === "verifying" ? task.reviewer : undefined;
    if (run?.sessionId && run.runId && run.startedAt !== undefined) {
      const key = JSON.stringify([run.sessionId, run.runId]);
      if (!context.registeredBudgetRuns.has(key)) {
        const parent = await context.budgetParent(task);
        const goalId = task.goalId ?? parent?.goalId;
        await context.store.db.checkAuthorization();
        await context.budgets.register({
          taskId: task.id,
          ...(goalId ? { goalId } : {}),
          ...(parent ? { parentTaskId: parent.id } : {}),
          role:
            task.status === "verifying"
              ? "reviewer"
              : task.blockedTakeover
                ? "recovery"
                : task.repairAttempts
                  ? "repair"
                  : "worker",
          sessionId: run.sessionId,
          runId: run.runId,
          startedAt: run.startedAt,
        });
        context.store.afterCommit(() => {
          context.registeredBudgetRuns.add(key);
        });
      }
    }
    task = { ...task, budgetUsage: await context.budgets.read({ taskId: task.id }) };
    const value = JSON.stringify(task);
    await context.store.db.checkAuthorization();
    await context.store.db
      .prepare("INSERT INTO tasks VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value")
      .run(task.id, value);
    persisted?.set(task.id, value);
    context.store.afterCommit(() => context.onChange?.());
    context.listCache = undefined;
    context.projectListCache.clear();
    context.schedulerTasks?.set(task.id, task);
    if (context.schedulerTasks) await context.hydrateDependencies(context.schedulerTasks, [task]);
    return task;
  };
  return reviewed
    ? await context.store.transaction(persist)
    : await context.store.db.scope(persist);
}
