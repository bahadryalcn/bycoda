import type { HostStore } from "../store";
import {
  checkpointRunElapsed,
  confirmedRunElapsed,
  finishedRunElapsed,
} from "../execution/run-duration";
import { sessionBudgetTokens } from "../../src/features/usage/model/usageBudgets";
import { monotonicNow } from "../../src/shared/lib/time/timestamps";
import type { Block } from "../../src/features/sessions/model/session";
import {
  type BudgetRunRole,
  type TaskBudgetScope,
  type TaskRunBudget,
  type TaskRunBudgetEvaluation,
  type TaskRunBudgetUsage,
} from "../../src/features/tasks/model/taskBudget";

export type BudgetRunRegistration = {
  /** Work identity extends the existing ledger; it never creates another total. */
  workId?: string;
  rootWorkId?: string;
  provider?: string;
  accountId?: string;
  taskId?: string;
  parentTaskId?: string;
  goalId?: string;
  role: BudgetRunRole;
  sessionId: string;
  runId: string;
  startedAt: number;
};
type LedgerRun = BudgetRunRegistration & {
  receiptKind?: "helper";
  usageIntervals?: Array<{
    from: number;
    to: number;
    tokens: number | null;
    costUsd: number | null;
  }>;
  tokensObservedAt?: number;
  costObservedAt?: number;
  blockId?: string;
  elapsedMs: number;
  confirmedElapsedMs?: number;
  awaitingFinishCheckpoint?: boolean;
  settledAt?: number;
  /** Session revision last observed after settlement; unchanged means nothing to re-read. */
  observedRevision?: number;
  /**
   * Proven unable to receive provider usage: a later turn exists and the session's current run
   * is another one (turn metrics merge into the latest turn, the cumulative bill into the
   * current run), or the transcript is gone. Permanent once set; the only way a session-observed
   * run becomes sealable.
   */
  superseded?: true;
  tokens: number | null;
  costBaseline: number | null;
  costUsd: number | null;
};
const roles: BudgetRunRole[] = [
  "advisor",
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

/**
 * A settled, fully observed run whose session has moved on stops being re-read this long after it
 * settled. Its numbers move into the per-scope rollup exactly once and its row stays as the
 * immutable receipt. Age alone never seals: provider usage merges into the session's latest turn
 * and its cumulative bill, so only a run proven unable to receive more usage may be sealed (see
 * `LedgerRun.superseded`). The latest turn of an idle session stays open and keeps counting late
 * usage; open rows are bounded by live sessions, never by the lifetime run count.
 */
export const BUDGET_RUN_SEAL_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** Rows whose numbers can still change. Sealed rows are final and counted by the rollup. */
const OPEN = "sealed_settled_at IS NULL";

/** Additive totals of the sealed runs of one task or goal scope. */
type Rollup = {
  attempts: number;
  elapsedMs: number;
  confirmedMs: number;
  tokens: number;
  unknownTokenRuns: number;
  cost: number;
  unknownCosts: number;
};
const emptyRollup = (): Rollup => ({
  attempts: 0,
  elapsedMs: 0,
  confirmedMs: 0,
  tokens: 0,
  unknownTokenRuns: 0,
  cost: 0,
  unknownCosts: 0,
});

type RollupScope = readonly ["task" | "goal", string];
const scopesOf = (run: LedgerRun): RollupScope[] => [
  ...(run.taskId ? [["task", run.taskId] as const] : []),
  ...(run.parentTaskId ? [["task", run.parentTaskId] as const] : []),
  ...(run.goalId ? [["goal", run.goalId] as const] : []),
];

/** A host-owned immutable run identity ledger. Removing task/chat history never resets its totals. */
export class HostTaskBudgets {
  readonly ready: Promise<void>;
  constructor(
    private readonly store: HostStore,
    private readonly now: () => number = Date.now,
    private readonly monotonic: () => number = monotonicNow,
  ) {
    this.ready = (async () => {
      await store.ready;

      await store.db.scope(async () => {
        await store.db.exec(`CREATE TABLE IF NOT EXISTS task_run_budget_ledger (
      session_id TEXT NOT NULL,run_id TEXT NOT NULL,task_id TEXT,goal_id TEXT,value TEXT NOT NULL,parent_task_id TEXT,
      sealed_settled_at INTEGER,
      PRIMARY KEY(session_id,run_id));
      CREATE INDEX IF NOT EXISTS task_run_budget_task ON task_run_budget_ledger(task_id);
      CREATE INDEX IF NOT EXISTS task_run_budget_goal ON task_run_budget_ledger(goal_id);`);
        await store.db.exec(`CREATE TABLE IF NOT EXISTS task_run_budget_history (
      scope TEXT NOT NULL,id TEXT NOT NULL,complete INTEGER NOT NULL,PRIMARY KEY(scope,id));
      CREATE TABLE IF NOT EXISTS task_run_budget_rollup (
      scope TEXT NOT NULL,id TEXT NOT NULL,attempts INTEGER NOT NULL,elapsed_ms REAL NOT NULL,
      confirmed_ms REAL NOT NULL,tokens REAL NOT NULL,unknown_token_runs INTEGER NOT NULL,
      cost REAL NOT NULL,unknown_costs INTEGER NOT NULL,uncertain INTEGER NOT NULL,
      PRIMARY KEY(scope,id)) WITHOUT ROWID;`);
        const columns = new Set(
          (await store.db.prepare("PRAGMA table_info(task_run_budget_ledger)").all()).map((row) =>
            String(row.name),
          ),
        );
        if (!columns.has("parent_task_id"))
          await store.db.exec("ALTER TABLE task_run_budget_ledger ADD COLUMN parent_task_id TEXT;");
        // NULL = open: its numbers can still change. Otherwise the run's settlement time; the
        // run is counted in the rollup and no hot path reads it again. Existing rows start open
        // and seal on their first sync once they qualify.
        if (!columns.has("sealed_settled_at"))
          await store.db.exec(
            "ALTER TABLE task_run_budget_ledger ADD COLUMN sealed_settled_at INTEGER;",
          );
        await store.db.exec(`
      CREATE INDEX IF NOT EXISTS task_run_budget_parent ON task_run_budget_ledger(parent_task_id);
      CREATE INDEX IF NOT EXISTS task_run_budget_open_task ON task_run_budget_ledger(task_id) WHERE ${OPEN};
      CREATE INDEX IF NOT EXISTS task_run_budget_open_parent ON task_run_budget_ledger(parent_task_id) WHERE ${OPEN};
      CREATE INDEX IF NOT EXISTS task_run_budget_open_goal ON task_run_budget_ledger(goal_id) WHERE ${OPEN};
      CREATE INDEX IF NOT EXISTS task_run_budget_open_all ON task_run_budget_ledger(session_id) WHERE ${OPEN};
      CREATE INDEX IF NOT EXISTS task_run_budget_sealed_settled ON task_run_budget_ledger(sealed_settled_at) WHERE sealed_settled_at IS NOT NULL;`);
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
        (!identity(input.taskId) && !identity(input.goalId) && !identity(input.workId)) ||
        [input.workId, input.rootWorkId, input.provider, input.accountId].some(
          (value) => value !== undefined && !identity(value),
        ) ||
        (input.taskId !== undefined && !identity(input.taskId)) ||
        (input.parentTaskId !== undefined &&
          (!identity(input.parentTaskId) || input.parentTaskId === input.taskId)) ||
        (input.goalId !== undefined && !identity(input.goalId))
      )
        throw new Error("Invalid budget run identity.");
      const existing = await this.store.db
        .prepare(
          "SELECT value,sealed_settled_at FROM task_run_budget_ledger WHERE session_id=? AND run_id=?",
        )
        .get(input.sessionId, input.runId);
      if (existing) {
        const previous = JSON.parse(String(existing.value)) as LedgerRun;
        for (const key of ["workId", "rootWorkId", "provider", "accountId"] as const) {
          if (
            input[key] !== undefined &&
            previous[key] !== undefined &&
            input[key] !== previous[key]
          )
            throw new Error("This budget run belongs to a different Work execution identity.");
        }
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
        if (
          (!previous.parentTaskId && input.parentTaskId) ||
          (!previous.goalId && input.goalId) ||
          ["workId", "rootWorkId", "provider", "accountId"].some(
            (key) =>
              previous[key as keyof BudgetRunRegistration] === undefined &&
              input[key as keyof BudgetRunRegistration] !== undefined,
          )
        ) {
          // A sealed run is already in its scopes' rollups; a scope it newly joins gets it once.
          const joined: RollupScope[] =
            existing.sealed_settled_at === null || existing.sealed_settled_at === undefined
              ? []
              : [
                  ...(!previous.parentTaskId && input.parentTaskId
                    ? [["task", input.parentTaskId] as const]
                    : []),
                  ...(!previous.goalId && input.goalId ? [["goal", input.goalId] as const] : []),
                ];
          previous.workId ??= input.workId;
          previous.rootWorkId ??= input.rootWorkId;
          previous.provider ??= input.provider;
          previous.accountId ??= input.accountId;
          previous.parentTaskId ??= input.parentTaskId;
          previous.goalId ??= input.goalId;
          await this.store.transaction(async () => {
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
            await this.addToRollups(previous, joined);
          });
        }
        return;
      }
      // Settle a retained review's earlier turn before capturing the next turn's baseline.
      await this.syncRows(
        await this.store.db
          .prepare(`SELECT value FROM task_run_budget_ledger WHERE session_id=? AND ${OPEN}`)
          .all(input.sessionId),
      );
      let blockId: string | undefined;
      let costBaseline: number | null = null;
      let provider = input.provider;
      let accountId = input.accountId;
      try {
        const session = await this.store.session(input.sessionId);
        if (session.runId === input.runId) {
          provider ??= session.session.harness;
          accountId ??= session.session.providerAccountId;
        }
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
        provider,
        accountId,
        blockId,
        elapsedMs: 0,
        confirmedElapsedMs: 0,
        tokens: null,
        costBaseline,
        costUsd: null,
      };
      await confirmedRunElapsed(
        this.store,
        input.sessionId,
        input.runId,
        this.now(),
        this.monotonic(),
      );
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

  private scopeOf(scope: TaskBudgetScope): { kind: "task" | "goal"; id: string } {
    const task = "taskId" in scope && scope.taskId !== undefined;
    const id = task ? scope.taskId : scope.goalId;
    if (!identity(id) || (scope.taskId !== undefined && scope.goalId !== undefined))
      throw new Error("Invalid run budget scope.");
    return { kind: task ? "task" : "goal", id };
  }

  /** Open rows only: sealed runs are final and live in the rollup, never re-read. */
  private async openRows(scope?: TaskBudgetScope) {
    if (scope === undefined)
      return await this.store.db
        .prepare(`SELECT value FROM task_run_budget_ledger WHERE ${OPEN}`)
        .all();
    const { kind, id } = this.scopeOf(scope);
    const task = kind === "task";
    return await this.store.db
      .prepare(
        `SELECT value FROM task_run_budget_ledger WHERE ${task ? "(task_id=? OR parent_task_id=?)" : "goal_id=?"} AND ${OPEN}`,
      )
      .all(...(task ? [id, id] : [id]));
  }

  private async rollup(kind: "task" | "goal", id: string): Promise<Rollup> {
    const row = await this.store.db
      .prepare(
        "SELECT attempts,elapsed_ms,confirmed_ms,tokens,unknown_token_runs,cost,unknown_costs FROM task_run_budget_rollup WHERE scope=? AND id=?",
      )
      .get(kind, id);
    return row ? this.rollupOf(row) : emptyRollup();
  }

  private rollupOf(row: Record<string, unknown>): Rollup {
    return {
      attempts: Number(row.attempts),
      elapsedMs: Number(row.elapsed_ms),
      confirmedMs: Number(row.confirmed_ms),
      tokens: Number(row.tokens),
      unknownTokenRuns: Number(row.unknown_token_runs),
      cost: Number(row.cost),
      unknownCosts: Number(row.unknown_costs),
    };
  }

  /** Counts one sealed run into the given scopes. Call only in the transaction that seals it. */
  private async addToRollups(run: LedgerRun, scopes: readonly RollupScope[] = scopesOf(run)) {
    const add = this.store.db.prepare(
      // The `uncertain` column is kept for existing databases and always written 0.
      `INSERT INTO task_run_budget_rollup (scope,id,attempts,elapsed_ms,confirmed_ms,tokens,unknown_token_runs,cost,unknown_costs,uncertain)
       VALUES (?,?,1,?,?,?,?,?,?,0)
       ON CONFLICT(scope,id) DO UPDATE SET attempts=attempts+1,elapsed_ms=elapsed_ms+excluded.elapsed_ms,
         confirmed_ms=confirmed_ms+excluded.confirmed_ms,tokens=tokens+excluded.tokens,
         unknown_token_runs=unknown_token_runs+excluded.unknown_token_runs,cost=cost+excluded.cost,
         unknown_costs=unknown_costs+excluded.unknown_costs`,
    );
    for (const [kind, id] of scopes)
      await add.run(
        kind,
        id,
        run.elapsedMs,
        run.confirmedElapsedMs ?? 0,
        run.tokens ?? 0,
        run.tokens === null ? 1 : 0,
        run.costUsd ?? 0,
        run.costUsd === null ? 1 : 0,
      );
  }

  /** Only a settled run whose numbers can no longer change. Active debits never qualify. */
  private canSeal(run: LedgerRun, now: number): boolean {
    if (
      run.settledAt === undefined ||
      run.confirmedElapsedMs === undefined ||
      !finite(run.settledAt) ||
      !finite(run.startedAt) ||
      run.settledAt < run.startedAt
    )
      return false;
    // Isolated helpers settle durably and are never observed through a session.
    if (run.receiptKind === "helper") return true;
    return (
      run.superseded === true &&
      !run.awaitingFinishCheckpoint &&
      now - run.settledAt >= BUDGET_RUN_SEAL_AFTER_MS
    );
  }

  /**
   * Turn metrics merge into the session's latest user block (a continuation into its root), so a
   * run's block can no longer change once a later sent turn exists, or when the block is gone.
   * Drafts and continuations of the run's own turn do not count: they can still route to it.
   */
  private tokensFrozen(blocks: readonly Block[], run: LedgerRun): boolean {
    const index = blocks.findIndex((block) => block.id === run.blockId);
    if (index < 0) return true;
    return blocks
      .slice(index + 1)
      .some((block) => block.role === "user" && !block.draft && !block.continuationOf);
  }

  /** Writes the run's value and, once final, seals it and counts it in its rollups exactly once. */
  private async persistRun(run: LedgerRun, stored: string, now: number): Promise<void> {
    const value = JSON.stringify(run);
    if (!this.canSeal(run, now)) {
      if (value !== stored)
        await this.store.db
          .prepare("UPDATE task_run_budget_ledger SET value=? WHERE session_id=? AND run_id=?")
          .run(value, run.sessionId, run.runId);
      return;
    }
    await this.store.transaction(async () => {
      const sealed = await this.store.db
        .prepare(
          `UPDATE task_run_budget_ledger SET value=?,sealed_settled_at=? WHERE session_id=? AND run_id=? AND ${OPEN}`,
        )
        .run(value, run.settledAt!, run.sessionId, run.runId);
      if (Number(sealed.changes) === 1) await this.addToRollups(run);
    });
  }

  private async syncRows(rows: { value?: unknown }[]): Promise<void> {
    const now = this.now();
    for (const row of rows) {
      const run = JSON.parse(String(row.value)) as LedgerRun;
      // Isolated helpers own durable settlement; no project session exists to observe.
      if (run.receiptKind === "helper") {
        await this.persistRun(run, JSON.stringify(run), now);
        continue;
      }
      // A settled run's numbers only change when its session changes (late usage, a missing
      // finish checkpoint). Skip loading the transcript while the indexed revision is unchanged.
      if (
        run.settledAt !== undefined &&
        !run.awaitingFinishCheckpoint &&
        run.confirmedElapsedMs !== undefined &&
        (await this.store.sessionRevision(run.sessionId)) === run.observedRevision
      ) {
        if (this.canSeal(run, now)) await this.persistRun(run, JSON.stringify(run), now);
        continue;
      }
      const previous = JSON.stringify(run);
      const previousTokens = run.tokens;
      const previousCost = run.costUsd;
      if (run.confirmedElapsedMs === undefined) {
        // A legacy run without checkpoints counts what was recorded.
        run.confirmedElapsedMs = run.elapsedMs;
      }
      try {
        const session = await this.store.session(run.sessionId);
        if (session.runId === run.runId) {
          run.provider ??= session.session.harness;
          run.accountId ??= session.session.providerAccountId;
        }
        const block = session.session.blocks.find((entry) => entry.id === run.blockId);
        const running = session.status === "running" && session.runId === run.runId;
        if (run.settledAt === undefined && !running) {
          run.settledAt = now;
          // The owned lifecycle close record is final; without it the last checkpoint counts
          // and a later close record replaces it.
          const finished = await finishedRunElapsed(this.store, run.sessionId, run.runId);
          const elapsed =
            finished ?? (await checkpointRunElapsed(this.store, run.sessionId, run.runId));
          run.confirmedElapsedMs = run.elapsedMs = Math.max(run.elapsedMs, elapsed);
          if (finished === null) run.awaitingFinishCheckpoint = true;
        } else if (run.settledAt !== undefined && run.awaitingFinishCheckpoint) {
          const finished = await finishedRunElapsed(this.store, run.sessionId, run.runId);
          if (finished !== null) {
            run.confirmedElapsedMs = run.elapsedMs = Math.max(run.elapsedMs, finished);
            delete run.awaitingFinishCheckpoint;
          }
        }
        if (run.settledAt === undefined) {
          const elapsed = await confirmedRunElapsed(
            this.store,
            run.sessionId,
            run.runId,
            now,
            this.monotonic(),
          );
          run.confirmedElapsedMs = run.elapsedMs = Math.max(run.elapsedMs, elapsed);
        }
        if (block) {
          const tokens = sessionBudgetTokens({ ...session.session, blocks: [block] }, "all", now);
          if (tokens !== null && Number.isSafeInteger(tokens))
            run.tokens = Math.max(run.tokens ?? 0, tokens);
        }
        const cost = session.session.usage?.costUsd;
        // A later turn's cumulative bill must not be charged to an earlier retained turn.
        if (session.runId === run.runId && finite(cost) && run.costBaseline !== null)
          run.costUsd = Math.max(run.costUsd ?? 0, cost - run.costBaseline, 0);
        if (run.settledAt !== undefined) {
          run.observedRevision = session.revision;
          if (session.runId !== run.runId && this.tokensFrozen(session.session.blocks, run))
            run.superseded = true;
        }
      } catch {
        delete run.observedRevision;
        // A deleted transcript can report nothing more. Any other failure may be transient.
        if ((await this.store.sessionRevision(run.sessionId).catch(() => 0)) === undefined)
          run.superseded = true;
        // Keep the last durable measurements after history deletion. Missing metrics remain unknown.
        if (run.settledAt === undefined) {
          run.settledAt = now;
          await this.markRunUnknownHistory(run);
        }
      }
      // A cumulative observation proves a delta over an interval, never its distribution.
      // Calendar readers keep boundary-spanning intervals unknown instead of prorating.
      if (run.tokens !== null && run.tokens !== previousTokens) {
        (run.usageIntervals ??= []).push({
          from: run.tokensObservedAt ?? run.startedAt,
          to: now,
          tokens: run.tokens - (previousTokens ?? 0),
          costUsd: null,
        });
        run.tokensObservedAt = now;
      }
      if (run.costUsd !== null && run.costUsd !== previousCost) {
        (run.usageIntervals ??= []).push({
          from: run.costObservedAt ?? run.startedAt,
          to: now,
          tokens: null,
          costUsd: run.costUsd - (previousCost ?? 0),
        });
        run.costObservedAt = now;
      }
      await this.persistRun(run, previous, now);
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
      await this.syncRows(await this.openRows(scope));
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

  /** Usage of one scope: its sealed rollup plus the open runs, with the confirmed agent time. */
  private async measure(scope: TaskBudgetScope) {
    const { kind, id } = this.scopeOf(scope);
    await this.syncRows(await this.openRows(scope));
    // Syncing can seal runs into the rollup, so read both halves afterwards, in one lane turn.
    const open = (await this.openRows(scope)).map(
      (row) => JSON.parse(String(row.value)) as LedgerRun,
    );
    const base = await this.rollup(kind, id);
    const history = await this.store.db
      .prepare("SELECT complete FROM task_run_budget_history WHERE scope=? AND id=?")
      .get(kind, id);
    const historyKnown = history?.complete !== 0;
    return {
      usage: this.summarize(open, historyKnown, base),
      historyKnown,
    };
  }

  async read(scope: TaskBudgetScope): Promise<TaskRunBudgetUsage> {
    await this.ready;

    return await this.store.db.scope(async () => (await this.measure(scope)).usage);
  }

  /** Refresh goal ledger receipts on the scheduler, off the list request path. */
  async syncGoalUsage(): Promise<void> {
    await this.ready;
    await this.store.db.scope(async () => {
      // Only open rows are visited, and of those only the ones that can still change or are
      // due to seal (superseded and old enough); the work tracks live sessions, never the
      // lifetime run count. A settled run whose session did not change has nothing to re-read.
      const rows = await this.store.db
        .prepare(
          `SELECT ledger.value FROM task_run_budget_ledger ledger
         LEFT JOIN session_state session ON session.id=ledger.session_id
         WHERE ledger.goal_id IS NOT NULL AND ledger.${OPEN}
           AND CASE WHEN json_extract(ledger.value,'$.receiptKind')='helper'
             THEN json_extract(ledger.value,'$.settledAt') IS NOT NULL
             ELSE (json_extract(ledger.value,'$.settledAt') IS NULL
               OR json_extract(ledger.value,'$.confirmedElapsedMs') IS NULL
               OR json_extract(ledger.value,'$.awaitingFinishCheckpoint')=1
               OR json_extract(ledger.value,'$.observedRevision') IS NOT session.revision
               OR (json_extract(ledger.value,'$.superseded')=1
                 AND json_extract(ledger.value,'$.settledAt')<=?)) END`,
        )
        .all(this.now() - BUDGET_RUN_SEAL_AFTER_MS);
      await this.syncRows(rows);
    });
  }

  async readGoalUsage(goalIds: string[]): Promise<Map<string, TaskRunBudgetUsage>> {
    await this.ready;
    return await this.store.db.scope(async () => {
      const ids = JSON.stringify([...new Set(goalIds)]);
      const history = await this.store.db
        .prepare(
          `SELECT ids.value AS goal_id, history.complete
         FROM json_each(?) ids
         LEFT JOIN task_run_budget_history history ON history.scope='goal' AND history.id=ids.value`,
        )
        .all(ids);
      const open = await this.store.db
        .prepare(
          `SELECT ledger.goal_id, ledger.value FROM json_each(?) ids
         JOIN task_run_budget_ledger ledger ON ledger.goal_id=ids.value AND ledger.${OPEN}`,
        )
        .all(ids);
      const sealed = await this.store.db
        .prepare(
          `SELECT rollup.id AS goal_id, rollup.attempts, rollup.elapsed_ms, rollup.confirmed_ms, rollup.tokens,
           rollup.unknown_token_runs, rollup.cost, rollup.unknown_costs
         FROM json_each(?) ids JOIN task_run_budget_rollup rollup ON rollup.scope='goal' AND rollup.id=ids.value`,
        )
        .all(ids);
      const rollups = new Map(sealed.map((row) => [String(row.goal_id), this.rollupOf(row)]));
      const runs = new Map<string, LedgerRun[]>();
      for (const row of open) {
        const id = String(row.goal_id);
        const group = runs.get(id) ?? [];
        group.push(JSON.parse(String(row.value)) as LedgerRun);
        runs.set(id, group);
      }
      return new Map(
        history.map((row) => {
          const id = String(row.goal_id);
          return [
            id,
            this.summarize(
              runs.get(id) ?? [],
              row.complete !== 0,
              rollups.get(id) ?? emptyRollup(),
            ),
          ];
        }),
      );
    });
  }

  private summarize(
    rows: LedgerRun[],
    knownHistory: boolean,
    base: Rollup = emptyRollup(),
  ): TaskRunBudgetUsage {
    const now = this.now();
    let elapsedMs = base.elapsedMs,
      reportedTokens = base.tokens,
      knownCost = base.cost,
      unknownTokenRuns = base.unknownTokenRuns,
      unknownCosts = base.unknownCosts,
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
      knownHistory &&
      unknownTokenRuns === 0 &&
      runningRuns === 0 &&
      Number.isSafeInteger(reportedTokens);
    return {
      agentMinutes: elapsedMs / 60_000,
      attempts: base.attempts + rows.length,
      completedRuns: base.attempts + rows.length - runningRuns,
      runningRuns,
      reportedTokens,
      tokens: tokensComplete ? reportedTokens : null,
      tokensComplete,
      unknownTokenRuns,
      reportedCostUsd: unknownCosts || !knownHistory ? null : knownCost,
      estimatedCostUsd: null,
      measuredAt: now,
    };
  }

  async evaluate(
    scope: TaskBudgetScope,
    budget: TaskRunBudget | undefined,
    options: { starting?: boolean } = {},
  ): Promise<TaskRunBudgetEvaluation> {
    await this.ready;

    return await this.store.db.scope(async () => {
      const { usage, historyKnown } = await this.measure(scope);
      const reasons: string[] = [];
      let warning = false;
      const threshold = (budget?.warningPercent ?? 80) / 100;
      const total = budget?.maxAgentMinutes;
      // Runtime is the observed time; a gap adds nothing. Only time >= the limit exhausts.
      if (budget && !historyKnown) {
        warning = true;
        if (options.starting && !total)
          reasons.push(
            "Historical usage is incomplete. Start a new task or goal, or remove total run limits to continue; earlier work is retained.",
          );
      }
      if (total) {
        if (usage.agentMinutes >= total)
          reasons.push(
            "The total agent-time budget is exhausted. Increase the budget to continue; completed work is retained.",
          );
        warning ||= usage.agentMinutes >= total * threshold;
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
