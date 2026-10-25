import type { HostStore } from "./store";
import { sessionBudgetTokens } from "../src/features/usage/model/usageBudgets";
import type {
  BudgetRunRole,
  TaskBudgetScope,
  TaskRunBudget,
  TaskRunBudgetEvaluation,
  TaskRunBudgetUsage,
} from "../src/features/tasks/model/taskBudget";

export type BudgetRunRegistration = {
  taskId?: string;
  parentTaskId?: string;
  goalId?: string;
  role: BudgetRunRole;
  sessionId: string;
  runId: string;
  startedAt: number;
};
type LedgerRun = BudgetRunRegistration & {
  blockId?: string;
  elapsedMs: number;
  settledAt?: number;
  tokens: number | null;
  costBaseline: number | null;
  costUsd: number | null;
};
const roles: BudgetRunRole[] = [
  "planner",
  "worker",
  "reviewer",
  "repair",
  "recovery",
  "final-review",
];
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const identity = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256 && !value.includes("\0");

/** A host-owned immutable run identity ledger. Removing task/chat history never resets its totals. */
export class HostTaskBudgets {
  readonly ready: Promise<void>;
  constructor(
    private readonly store: HostStore,
    private readonly now: () => number = Date.now,
  ) {
    this.ready = (async () => {
      await store.ready;

      await store.db.scope(async () => {
        await store.db.exec(`CREATE TABLE IF NOT EXISTS task_run_budget_ledger (
      session_id TEXT NOT NULL,run_id TEXT NOT NULL,task_id TEXT,goal_id TEXT,value TEXT NOT NULL,parent_task_id TEXT,
      PRIMARY KEY(session_id,run_id));
      CREATE INDEX IF NOT EXISTS task_run_budget_task ON task_run_budget_ledger(task_id);
      CREATE INDEX IF NOT EXISTS task_run_budget_goal ON task_run_budget_ledger(goal_id);`);
        await store.db.exec(`CREATE TABLE IF NOT EXISTS task_run_budget_history (
      scope TEXT NOT NULL,id TEXT NOT NULL,complete INTEGER NOT NULL,PRIMARY KEY(scope,id));`);
        if (
          !(await store.db.prepare("PRAGMA table_info(task_run_budget_ledger)").all()).some(
            (row) => row.name === "parent_task_id",
          )
        )
          await store.db.exec("ALTER TABLE task_run_budget_ledger ADD COLUMN parent_task_id TEXT;");
        await store.db.exec(
          "CREATE INDEX IF NOT EXISTS task_run_budget_parent ON task_run_budget_ledger(parent_task_id);",
        );
      });
    })();
  }

  async register(input: BudgetRunRegistration): Promise<void> {
    await this.ready;

    return await this.store.db.scope(async () => {
      if (
        !identity(input.sessionId) ||
        !identity(input.runId) ||
        !roles.includes(input.role) ||
        !finite(input.startedAt) ||
        (!identity(input.taskId) && !identity(input.goalId)) ||
        (input.taskId !== undefined && !identity(input.taskId)) ||
        (input.parentTaskId !== undefined &&
          (!identity(input.parentTaskId) || input.parentTaskId === input.taskId)) ||
        (input.goalId !== undefined && !identity(input.goalId))
      )
        throw new Error("Invalid budget run identity.");
      const existing = await this.store.db
        .prepare("SELECT value FROM task_run_budget_ledger WHERE session_id=? AND run_id=?")
        .get(input.sessionId, input.runId);
      if (existing) {
        const previous = JSON.parse(String(existing.value)) as LedgerRun;
        if (
          previous.taskId !== input.taskId ||
          (previous.goalId !== undefined &&
            input.goalId !== undefined &&
            previous.goalId !== input.goalId) ||
          (previous.parentTaskId !== undefined &&
            input.parentTaskId !== undefined &&
            previous.parentTaskId !== input.parentTaskId) ||
          previous.role !== input.role
        )
          throw new Error("This budget run belongs to a different task, goal or role.");
        if ((!previous.parentTaskId && input.parentTaskId) || (!previous.goalId && input.goalId)) {
          previous.parentTaskId ??= input.parentTaskId;
          previous.goalId ??= input.goalId;
          await this.store.db
            .prepare(
              "UPDATE task_run_budget_ledger SET goal_id=?,parent_task_id=?,value=? WHERE session_id=? AND run_id=?",
            )
            .run(
              previous.goalId ?? null,
              previous.parentTaskId ?? null,
              JSON.stringify(previous),
              input.sessionId,
              input.runId,
            );
        }
        return;
      }
      // Settle a retained review's earlier turn before capturing the next turn's baseline.
      await this.syncRows(
        await this.store.db
          .prepare("SELECT value FROM task_run_budget_ledger WHERE session_id=?")
          .all(input.sessionId),
      );
      let blockId: string | undefined;
      let costBaseline: number | null = null;
      try {
        const session = await this.store.session(input.sessionId);
        const turns = session.session.blocks.filter(
          (block) => block.role === "user" && !block.draft && !block.continuationOf,
        );
        blockId = turns.at(-1)?.id;
        const earlier = (
          await this.store.db
            .prepare("SELECT value FROM task_run_budget_ledger WHERE session_id=?")
            .all(input.sessionId)
        ).map((row) => JSON.parse(String(row.value)) as LedgerRun);
        // The current turn can already have reported a bill by registration time. Its
        // charge belongs to this run, so never use the current cumulative bill as baseline.
        costBaseline =
          turns.length <= 1
            ? 0
            : earlier.length === turns.length - 1 && earlier.every((run) => run.costUsd !== null)
              ? earlier.reduce((sum, run) => sum + run.costUsd!, 0)
              : null;
      } catch {
        /* A launch receipt can outlive the session; usage remains explicitly unknown. */
      }
      const run: LedgerRun = {
        ...input,
        blockId,
        elapsedMs: 0,
        tokens: null,
        costBaseline,
        costUsd: null,
      };
      await this.store.db
        .prepare(
          "INSERT INTO task_run_budget_ledger (session_id,run_id,task_id,goal_id,value,parent_task_id) VALUES (?,?,?,?,?,?)",
        )
        .run(
          input.sessionId,
          input.runId,
          input.taskId ?? null,
          input.goalId ?? null,
          JSON.stringify(run),
          input.parentTaskId ?? null,
        );
    });
  }

  private async rows(scope?: TaskBudgetScope) {
    if (scope === undefined)
      return await this.store.db.prepare("SELECT value FROM task_run_budget_ledger").all();
    const task = "taskId" in scope && scope.taskId !== undefined;
    const id = task ? scope.taskId : scope.goalId;
    if (!identity(id) || (scope.taskId !== undefined && scope.goalId !== undefined))
      throw new Error("Invalid run budget scope.");
    return await this.store.db
      .prepare(
        `SELECT value FROM task_run_budget_ledger WHERE ${task ? "task_id=? OR parent_task_id=?" : "goal_id=?"}`,
      )
      .all(...(task ? [id, id] : [id]));
  }

  private async syncRows(rows: { value?: unknown }[]): Promise<void> {
    const now = this.now();
    for (const row of rows) {
      const run = JSON.parse(String(row.value)) as LedgerRun;
      const previous = JSON.stringify(run);
      try {
        const session = await this.store.session(run.sessionId);
        const block = session.session.blocks.find((entry) => entry.id === run.blockId);
        const running = session.status === "running" && session.runId === run.runId;
        if (run.settledAt === undefined && !running) {
          run.settledAt = now;
          // The next poll is not an execution end timestamp. A missing duration
          // can include host downtime, removed history or an unobserved later turn.
          if (!block || !finite(block.durationMs)) await this.markRunUnknownHistory(run);
        }
        if (run.settledAt === undefined) run.elapsedMs = Math.max(0, now - run.startedAt);
        else if (block && finite(block.durationMs)) run.elapsedMs = block.durationMs;
        if (block) {
          const tokens = sessionBudgetTokens({ ...session.session, blocks: [block] }, "all", now);
          if (tokens !== null && Number.isSafeInteger(tokens))
            run.tokens = Math.max(run.tokens ?? 0, tokens);
        }
        const cost = session.session.usage?.costUsd;
        // A later turn's cumulative bill must not be charged to an earlier retained turn.
        if (session.runId === run.runId && finite(cost) && run.costBaseline !== null)
          run.costUsd = Math.max(run.costUsd ?? 0, cost - run.costBaseline, 0);
      } catch {
        // Keep the last durable measurements after history deletion. Missing metrics remain unknown.
        if (run.settledAt === undefined) {
          run.settledAt = now;
          await this.markRunUnknownHistory(run);
        }
      }
      if (JSON.stringify(run) !== previous)
        await this.store.db
          .prepare("UPDATE task_run_budget_ledger SET value=? WHERE session_id=? AND run_id=?")
          .run(JSON.stringify(run), run.sessionId, run.runId);
    }
  }

  private async markRunUnknownHistory(run: LedgerRun): Promise<void> {
    if (run.taskId) await this.markUnknownHistory({ taskId: run.taskId });
    if (run.parentTaskId) await this.markUnknownHistory({ taskId: run.parentTaskId });
    if (run.goalId) await this.markUnknownHistory({ goalId: run.goalId });
  }

  async sync(scope?: TaskBudgetScope): Promise<void> {
    await this.ready;

    return await this.store.db.scope(async () => {
      await this.syncRows(await this.rows(scope));
    });
  }

  /** Existing work without exact run receipts cannot become a measured zero at upgrade time. */
  async markUnknownHistory(scope: TaskBudgetScope): Promise<void> {
    await this.ready;

    return await this.store.db.scope(async () => {
      const task = scope.taskId !== undefined;
      const id = task ? scope.taskId : scope.goalId;
      if (!identity(id) || (scope.taskId !== undefined && scope.goalId !== undefined))
        throw new Error("Invalid run budget scope.");
      await this.store.db
        .prepare(
          "INSERT INTO task_run_budget_history (scope,id,complete) VALUES (?,?,0) ON CONFLICT(scope,id) DO UPDATE SET complete=0",
        )
        .run(task ? "task" : "goal", id);
    });
  }

  async read(scope: TaskBudgetScope): Promise<TaskRunBudgetUsage> {
    await this.ready;

    return await this.store.db.scope(async () => {
      const selected = await this.rows(scope);
      await this.syncRows(selected);
      const rows = (await this.rows(scope)).map(
        (row) => JSON.parse(String(row.value)) as LedgerRun,
      );
      const scopeKind = scope.taskId !== undefined ? "task" : "goal";
      const history = await this.store.db
        .prepare("SELECT complete FROM task_run_budget_history WHERE scope=? AND id=?")
        .get(scopeKind, scope.taskId ?? scope.goalId);
      const historyComplete = history?.complete !== 0;
      let elapsedMs = 0,
        reportedTokens = 0,
        knownCost = 0,
        unknownTokenRuns = 0,
        unknownCosts = 0,
        runningRuns = 0;
      for (const run of rows) {
        elapsedMs += run.elapsedMs;
        if (run.settledAt === undefined) runningRuns++;
        if (run.tokens === null) unknownTokenRuns++;
        else reportedTokens += run.tokens;
        if (run.costUsd === null) unknownCosts++;
        else knownCost += run.costUsd;
      }
      const tokensComplete =
        historyComplete &&
        unknownTokenRuns === 0 &&
        runningRuns === 0 &&
        Number.isSafeInteger(reportedTokens);
      return {
        historyComplete,
        agentMinutes: elapsedMs / 60_000,
        attempts: rows.length,
        completedRuns: rows.length - runningRuns,
        runningRuns,
        reportedTokens,
        tokens: tokensComplete ? reportedTokens : null,
        tokensComplete,
        unknownTokenRuns,
        reportedCostUsd: unknownCosts || !historyComplete ? null : knownCost,
        estimatedCostUsd: null,
        measuredAt: this.now(),
      };
    });
  }

  async evaluate(
    scope: TaskBudgetScope,
    budget: TaskRunBudget | undefined,
    options: { starting?: boolean } = {},
  ): Promise<TaskRunBudgetEvaluation> {
    await this.ready;

    return await this.store.db.scope(async () => {
      const usage = await this.read(scope);
      const reasons: string[] = [];
      let warning = false;
      const threshold = (budget?.warningPercent ?? 80) / 100;
      if (budget && !usage.historyComplete) {
        warning = true;
        if (options.starting)
          reasons.push(
            "Historical usage is incomplete. Start a new task or goal, or remove total run limits to continue; earlier work is retained.",
          );
      }
      if (budget?.maxAgentMinutes) {
        if (usage.agentMinutes >= budget.maxAgentMinutes)
          reasons.push(
            "The total agent-time budget is exhausted. Increase the budget to continue; completed work is retained.",
          );
        warning ||= usage.agentMinutes >= budget.maxAgentMinutes * threshold;
      }
      if (budget?.maxAttempts) {
        if (options.starting && usage.attempts >= budget.maxAttempts)
          reasons.push(
            "The total agent-run budget is exhausted. Increase the budget to start another run; completed work is retained.",
          );
        warning ||= usage.attempts >= budget.maxAttempts * threshold;
      }
      if (budget?.maxTokens) {
        if (usage.reportedTokens >= budget.maxTokens)
          reasons.push(
            "The total reported token budget is exhausted. Increase the budget to continue; completed work is retained.",
          );
        else if (options.starting && !usage.tokensComplete)
          reasons.push(
            "Token usage is unavailable for an earlier run. Refresh provider usage or adjust the token budget before starting another run.",
          );
        warning ||= !usage.tokensComplete || usage.reportedTokens >= budget.maxTokens * threshold;
      }
      return { usage, blocked: reasons.length > 0, warning, reasons };
    });
  }
}
