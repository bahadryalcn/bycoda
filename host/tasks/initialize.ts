import { type HostTask } from "../../src/features/tasks/model/hostTasks";
import type { HostEngine } from "../engine";
import { type SessionRunEngine } from "../sessions/sessionRuns";
import type { HostStore } from "../store";
import type { TaskContext } from "./context";
import { bindSessionWork } from "../work/session-adapter";
export function initialize(context: TaskContext, store: HostStore): Promise<void> {
  return (async () => {
    await store.ready;
    await context.limits.ready;
    await context.budgets.ready;
    await store.db.scope(async () => {
      await store.db.exec(
        "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE INDEX IF NOT EXISTS tasks_project ON tasks(json_extract(value, '$.projectId'));",
      );
      await store.db.exec(`
          CREATE TABLE IF NOT EXISTS task_admission_generation (id TEXT PRIMARY KEY, generation INTEGER NOT NULL);
          INSERT OR IGNORE INTO task_admission_generation SELECT id, 1 FROM tasks;
          CREATE TRIGGER IF NOT EXISTS task_admission_insert AFTER INSERT ON tasks BEGIN
            INSERT INTO task_admission_generation(id,generation) VALUES(NEW.id,1)
              ON CONFLICT(id) DO UPDATE SET generation=generation+1;
          END;
          CREATE TRIGGER IF NOT EXISTS task_admission_transition AFTER UPDATE ON tasks
          WHEN json_extract(OLD.value,'$.status') IS NOT json_extract(NEW.value,'$.status') BEGIN
            INSERT INTO task_admission_generation(id,generation) VALUES(NEW.id,1)
              ON CONFLICT(id) DO UPDATE SET generation=generation+1;
          END;
          CREATE TRIGGER IF NOT EXISTS task_admission_delete AFTER DELETE ON tasks BEGIN
            UPDATE task_admission_generation SET generation=generation+1 WHERE id=OLD.id;
          END;
        `);
      await store.db.exec("CREATE TABLE IF NOT EXISTS task_goal_holds(goal_id TEXT PRIMARY KEY);");
      await store.db.exec(
        "CREATE TABLE IF NOT EXISTS task_goal_reason_holds(goal_id TEXT NOT NULL,reason TEXT NOT NULL CHECK(reason IN ('assistant-budget','assistant-hours')),PRIMARY KEY(goal_id,reason));",
      );
      const reasonSchema = await store.db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='task_goal_reason_holds'",
        )
        .get();
      if (!String(reasonSchema?.sql ?? "").includes("'assistant-hours'"))
        await store.transaction(async () => {
          await store.db.exec(
            "ALTER TABLE task_goal_reason_holds RENAME TO task_goal_reason_holds_legacy_v1; CREATE TABLE task_goal_reason_holds(goal_id TEXT NOT NULL,reason TEXT NOT NULL CHECK(reason IN ('assistant-budget','assistant-hours')),PRIMARY KEY(goal_id,reason)); INSERT INTO task_goal_reason_holds(goal_id,reason) SELECT goal_id,reason FROM task_goal_reason_holds_legacy_v1; DROP TABLE task_goal_reason_holds_legacy_v1;",
          );
        }, "critical");
      await store.db.exec(
        "CREATE TABLE IF NOT EXISTS task_goal_deletion_holds(goal_id TEXT PRIMARY KEY,operation_id TEXT NOT NULL);",
      );
      for (const row of await store.db.prepare("SELECT goal_id FROM task_goal_holds").all())
        context.pausedGoals.add(String(row.goal_id));
      for (const row of await store.db
        .prepare("SELECT DISTINCT goal_id FROM task_goal_reason_holds")
        .all())
        context.pausedGoals.add(String(row.goal_id));
      for (const row of await store.db
        .prepare("SELECT goal_id FROM task_goal_deletion_holds")
        .all()) {
        context.pausedGoals.add(String(row.goal_id));
        context.assistantDeletionGoals.add(String(row.goal_id));
      }
      // Database-owned revisions also see recovery edits and another board's
      // writes, without discarding every historical JSON object on every tick.
      await store.db.exec(`
      CREATE TABLE IF NOT EXISTS task_cache_revision (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
      INSERT OR IGNORE INTO task_cache_revision VALUES (1, 0);
      CREATE TRIGGER IF NOT EXISTS task_cache_insert AFTER INSERT ON tasks BEGIN UPDATE task_cache_revision SET version=version+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS task_cache_update AFTER UPDATE ON tasks BEGIN UPDATE task_cache_revision SET version=version+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS task_cache_delete AFTER DELETE ON tasks BEGIN UPDATE task_cache_revision SET version=version+1 WHERE id=1; END;
      CREATE INDEX IF NOT EXISTS tasks_scheduler_status ON tasks(json_extract(value, '$.status'));
      CREATE INDEX IF NOT EXISTS tasks_scheduler_status_merged ON tasks(json_extract(value, '$.status'), json_extract(value, '$.merged'));
      CREATE INDEX IF NOT EXISTS tasks_scheduler_cleanup ON tasks(id)
        WHERE json_extract(value, '$.status')='done' AND json_extract(value, '$.merged')=1
          AND (json_extract(value, '$.worktreeCwd') IS NOT NULL OR json_array_length(value, '$.historyRecovery')>0);
    `);
      // SQLite owns the journal so every writer (including recovery and DELETE)
      // commits the task change and its history together. Do not journal prompts,
      // credentials or session output: planning only needs this compact projection.
      await store.db.exec(`
          CREATE TABLE IF NOT EXISTS task_history_meta (id INTEGER PRIMARY KEY CHECK(id=1), available_from INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS task_history_floor (id INTEGER PRIMARY KEY CHECK(id=1), sequence INTEGER NOT NULL);
          INSERT OR IGNORE INTO task_history_floor VALUES (1, 0);
          CREATE TABLE IF NOT EXISTS task_history (sequence INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, task_id TEXT NOT NULL, status TEXT NOT NULL, effective_at INTEGER NOT NULL, deleted INTEGER NOT NULL, task TEXT NOT NULL);
          CREATE TRIGGER IF NOT EXISTS task_history_insert AFTER INSERT ON tasks BEGIN
            INSERT INTO task_history(project_id,task_id,status,effective_at,deleted,task) VALUES (
              json_extract(NEW.value,'$.projectId'),NEW.id,json_extract(NEW.value,'$.status'),json_extract(NEW.value,'$.updatedAt'),0,
              json_object('id',NEW.id,'projectId',json_extract(NEW.value,'$.projectId'),'title',json_extract(NEW.value,'$.title'),'status',json_extract(NEW.value,'$.status'),'updatedAt',json_extract(NEW.value,'$.updatedAt'),'goalId',json_extract(NEW.value,'$.goalId')));
          END;
          CREATE TRIGGER IF NOT EXISTS task_history_update AFTER UPDATE ON tasks BEGIN
            INSERT INTO task_history(project_id,task_id,status,effective_at,deleted,task) VALUES (
              json_extract(NEW.value,'$.projectId'),NEW.id,json_extract(NEW.value,'$.status'),json_extract(NEW.value,'$.updatedAt'),0,
              json_object('id',NEW.id,'projectId',json_extract(NEW.value,'$.projectId'),'title',json_extract(NEW.value,'$.title'),'status',json_extract(NEW.value,'$.status'),'updatedAt',json_extract(NEW.value,'$.updatedAt'),'goalId',json_extract(NEW.value,'$.goalId')));
          END;
          CREATE TRIGGER IF NOT EXISTS task_history_transfer BEFORE UPDATE ON tasks
          WHEN json_extract(OLD.value,'$.projectId') IS NOT json_extract(NEW.value,'$.projectId') BEGIN
            INSERT INTO task_history(project_id,task_id,status,effective_at,deleted,task) VALUES (
              json_extract(OLD.value,'$.projectId'),OLD.id,json_extract(OLD.value,'$.status'),json_extract(NEW.value,'$.updatedAt'),1,
              json_object('id',OLD.id,'projectId',json_extract(OLD.value,'$.projectId'),'title',json_extract(OLD.value,'$.title'),'status',json_extract(OLD.value,'$.status'),'updatedAt',json_extract(OLD.value,'$.updatedAt'),'goalId',json_extract(OLD.value,'$.goalId')));
          END;
          CREATE TRIGGER IF NOT EXISTS task_history_delete AFTER DELETE ON tasks BEGIN
            INSERT INTO task_history(project_id,task_id,status,effective_at,deleted,task) VALUES (
              json_extract(OLD.value,'$.projectId'),OLD.id,json_extract(OLD.value,'$.status'),CAST(unixepoch('subsec')*1000 AS INTEGER),1,
              json_object('id',OLD.id,'projectId',json_extract(OLD.value,'$.projectId'),'title',json_extract(OLD.value,'$.title'),'status',json_extract(OLD.value,'$.status'),'updatedAt',json_extract(OLD.value,'$.updatedAt'),'goalId',json_extract(OLD.value,'$.goalId')));
          END;
        `);
      await store.db
        .prepare("INSERT OR IGNORE INTO task_history_meta VALUES (1, ?)")
        .run(context.now());
      const legacyRuns = await store.db
        .prepare(`SELECT value FROM tasks WHERE
      (json_extract(value, '$.startedAt') IS NOT NULL OR json_extract(value, '$.sessionId') IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM task_run_budget_ledger ledger WHERE ledger.task_id=tasks.id)`)
        .all();
      await store.db.exec("SAVEPOINT mark_legacy_task_usage");
      try {
        for (const row of legacyRuns) {
          const task = JSON.parse(String(row.value)) as HostTask;
          await context.budgets.markUnknownHistory({ taskId: task.id });
          const parent = await context.budgetParent(task);
          if (parent) await context.budgets.markUnknownHistory({ taskId: parent.id });
          const goalId = task.goalId ?? parent?.goalId;
          if (goalId) await context.budgets.markUnknownHistory({ goalId });
        }
        await store.db.exec("RELEASE mark_legacy_task_usage");
      } catch (error) {
        await store.db.exec("ROLLBACK TO mark_legacy_task_usage; RELEASE mark_legacy_task_usage");
        throw error;
      }
      context.limits.trackRuns(async () =>
        Array.from(
          (context.schedulerTasks ?? (await context.schedulerSnapshot(false))).values(),
        ).flatMap((task) =>
          task.status === "running" && task.crewExecutionId
            ? [{ sessionId: `\u0000crew-task:${task.id}`, runId: task.crewExecutionId }]
            : task.status === "running" && task.sessionId && task.runId
              ? [{ sessionId: task.sessionId, runId: task.runId }]
              : task.status === "verifying" && task.reviewer?.sessionId && task.reviewer.runId
                ? [{ sessionId: task.reviewer.sessionId, runId: task.reviewer.runId }]
                : [],
        ),
      );
    });
  })();
}

export function createTaskEngine(
  context: TaskContext,
  store: HostStore,
  engine: SessionRunEngine,
): SessionRunEngine {
  if (engine.withCommandAdmission) bindSessionWork(store, engine, context.limits, context.now);
  context.continueHistory = (
    engine as SessionRunEngine & Partial<Pick<HostEngine, "continueSessionHistory">>
  ).continueSessionHistory?.bind(engine);
  context.admitCommand = (
    engine as SessionRunEngine & Partial<Pick<HostEngine, "withCommandAdmission">>
  ).withCommandAdmission?.bind(engine);
  const recoveryEngine = engine as SessionRunEngine &
    Partial<Pick<HostEngine, "waitForRun" | "withRetiredProviderWriter" | "hasActiveRun">>;
  context.waitRecoveryRun = recoveryEngine.waitForRun?.bind(engine);
  context.retireRecoveryWriter = recoveryEngine.withRetiredProviderWriter?.bind(engine);
  context.activeRecoveryRun = recoveryEngine.hasActiveRun?.bind(engine);
  context.retainedDeletionWriter = (
    engine as SessionRunEngine & Partial<Pick<HostEngine, "hasRetainedProviderWriter">>
  ).hasRetainedProviderWriter?.bind(engine);
  context.sessionCheckpoints = (
    engine as SessionRunEngine & Partial<Pick<HostEngine, "checkpoints">>
  ).checkpoints;
  // Request guards stay in the Store's AsyncLocal context; autonomous calls have none.

  return {
    withMessageAuthor: engine.withMessageAuthor?.bind(engine),
    command: async (...args) => {
      await store.db.checkAuthorization();
      return engine.command(...args);
    },
    updateSession: async (...args) => {
      await store.db.checkAuthorization();
      return engine.updateSession(...args);
    },
  };
}
