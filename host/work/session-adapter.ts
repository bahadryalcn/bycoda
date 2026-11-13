import type {
  WorkSource,
  WorkRecord,
  WorkReceipt,
  WorkWait,
} from "../../src/shared/model/host-contracts/work";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { HostEngine } from "../engine";
import { HostLimits } from "../limits";
import type { HostStore } from "../store";
import {
  cancelSessionRun,
  sessionRunState,
  type SessionRunEngine,
  type SessionRunSpec,
} from "../sessions/sessionRuns";
import { HostWork } from "./service";
import { HostTaskBudgets, type BudgetRunRegistration } from "../tasks/task-budgets";
import { readModelRouting } from "../model-routing/storage";
import { readWorkUsage } from "./usage";
import { evaluateWorkCaps } from "./limits";
import { deferredAssistantTurn } from "../assistant/core/assistant-turn-policy";
import type { WorkCallbacks } from "./contracts";

export type RegisteredWorkExecutor = Pick<
  WorkCallbacks,
  "admit" | "resolve" | "launch" | "observe" | "stop"
>;

type LaunchResult = {
  sessionId?: string;
  runId?: string;
  error?: string;
  deferred?: boolean;
  wait?: WorkWait;
};
type PendingLaunch = {
  engine: SessionRunEngine;
  spec: SessionRunSpec;
  admitted: () => boolean | Promise<boolean>;
  launch: (spec: SessionRunSpec, admitted?: () => Promise<boolean>) => Promise<LaunchResult>;
};
const runtimes = new WeakMap<HostStore, SessionWorkAdapter>();
const commandId = (requestId: string, kind: "create" | "send") =>
  `work-${createHash("sha256")
    .update(JSON.stringify([requestId, kind]))
    .digest("hex")}`;
const deferredOccurrence = (work: WorkRecord) =>
  `deferred:${createHash("sha256")
    .update(JSON.stringify([work.source.occurrence, work.receipt!.sessionId, work.receipt!.runId]))
    .digest("hex")}`;

/** One durable queue per Host store. Producers re-enter their own permission and
 * workspace gates after restart; persisted payloads never run detached callbacks. */
export class SessionWorkAdapter {
  readonly work: HostWork;
  private readonly pending = new Map<string, PendingLaunch>();
  private readonly executors = new Map<string, RegisteredWorkExecutor>();
  private timer?: ReturnType<typeof setInterval>;
  private advancing?: Promise<void>;
  private closing = false;
  start(): void {
    if (this.timer) return;
    this.closing = false;
    this.store.db.outsideScope(() => {
      const advance = () => {
        if (this.advancing || this.closing) return;
        this.advancing = this.work
          .reconcile()
          .then(() => {
            if (!this.closing) return this.work.tick();
          })
          .catch((error) => console.error("Work scheduling failed:", error))
          .finally(() => {
            this.advancing = undefined;
          });
      };
      this.timer = setInterval(advance, 1000);
      this.timer.unref?.();
      advance();
    });
  }
  stop(): void {
    this.closing = true;
    clearInterval(this.timer);
    this.timer = undefined;
  }
  registerExecutor(key: string, executor: RegisteredWorkExecutor): void {
    if (!key.trim()) throw new Error("Work executor identity is required.");
    const existing = this.executors.get(key);
    if (existing && existing !== executor) throw new Error("Work executor is already registered.");
    this.executors.set(key, executor);
  }
  private executor(work: WorkRecord): RegisteredWorkExecutor | undefined {
    return typeof work.payload.executor === "string"
      ? this.executors.get(work.payload.executor)
      : undefined;
  }
  assertCoverageExecutors(): void {
    for (const key of ["assistant-text", "assistant-session", "room-automation"])
      if (!this.executors.has(key))
        throw new Error(`Work coverage executor is unavailable: ${key}`);
  }
  constructor(
    private readonly store: HostStore,
    private readonly engine: SessionRunEngine & Partial<Pick<HostEngine, "waitForRun">>,
    limits = new HostLimits(store),
    private readonly now: () => number = Date.now,
  ) {
    const budgets = new HostTaskBudgets(store, now);
    this.work = new HostWork(
      store,
      {
        admit: async (work) => {
          if (this.closing) return { code: "owner", message: "Host Work scheduling is stopping." };
          const executor = this.executor(work);
          const pending = this.pending.get(work.id);
          if (executor) {
            const denied = await executor.admit?.(work);
            if (denied) return denied;
          } else if (!pending || !(await pending.admitted()))
            return {
              code: "dependency",
              message: "Waiting for the producer to recheck its execution gates.",
            };
          const caps = (await readModelRouting(store)).workCaps;
          const coverage = await store.db
            .prepare("SELECT value FROM host_settings WHERE key='workCoverageSince'")
            .get();
          const coverageSince = coverage ? Number(coverage.value) : undefined;
          const selectedProvider = pending?.spec.harness ?? work.target?.model.harness;
          for (const [provider, cap] of [
            [undefined, caps?.total],
            [selectedProvider, selectedProvider ? caps?.providers?.[selectedProvider] : undefined],
          ] as const) {
            if (!cap) continue;
            const usage = await readWorkUsage(store, budgets, {
              now: now(),
              ...(provider ? { provider } : {}),
              ...(Number.isFinite(coverageSince) ? { coverageSince } : {}),
            });
            const wait = evaluateWorkCaps(cap, usage).waits[0];
            if (wait) return { code: "usageLimit", message: wait.reason };
          }
          return undefined;
        },
        resolve: async (work) => {
          const executor = this.executor(work);
          if (executor) return executor.resolve(work);
          const spec = this.pending.get(work.id)?.spec;
          if (!spec) return { wait: { code: "dependency", message: "Waiting for the producer." } };
          return {
            target: {
              model: {
                harness: spec.harness,
                model: spec.model,
                modelSettings: spec.modelSettings,
                ...(spec.providerAccountId === undefined
                  ? {}
                  : { providerAccountId: spec.providerAccountId }),
              },
              runtimeMode: spec.runtimeMode,
              permissionRevision: work.requestId,
              execution: {
                kind: "project",
                projectId: spec.projectId,
                ...(spec.workspaceId ? { workspaceId: spec.workspaceId } : {}),
                ...(spec.worktreeCwd ? { worktreeCwd: spec.worktreeCwd } : {}),
              },
            },
          };
        },
        launch: async (work, accepted) => {
          const executor = this.executor(work);
          if (executor) return executor.launch(work, accepted);
          const pending = this.pending.get(work.id);
          if (!pending || !this.engine.withCommandAdmission)
            throw new Error("Work command admission is unavailable.");
          await this.preparedSession(work);
          const result = await this.engine.withCommandAdmission(
            {
              check: async () => {
                const current = await this.work.get(work.id);
                if (current.stopRequested || current.state === "completed")
                  throw new Error("Work stopped before provider admission.");
                if (!(await pending.admitted()))
                  throw new Error("Work producer admission changed.");
              },
              onAccepted: async (receipt) => {
                if (!receipt.runId) return;
                await accepted({ sessionId: receipt.sessionId, runId: receipt.runId });
                const source = work.source;
                const task = source.kind.startsWith("task.") || source.kind === "crew.member";
                const goal = source.kind.startsWith("goal.");
                const rootTaskId = work.rootWorkId?.startsWith("task:")
                  ? work.rootWorkId.slice(5)
                  : undefined;
                const rootGoalId = work.rootWorkId?.startsWith("goal:")
                  ? work.rootWorkId.slice(5)
                  : undefined;
                const role: BudgetRunRegistration["role"] =
                  source.kind === "delegation.advisor"
                    ? "advisor"
                    : source.kind === "task.reviewer"
                      ? "reviewer"
                      : source.kind === "goal.planner"
                        ? "planner"
                        : source.kind === "goal.finalReview"
                          ? "final-review"
                          : source.kind === "task.repair"
                            ? "repair"
                            : source.kind === "task.recovery"
                              ? "recovery"
                              : "worker";
                const previous = await store.db
                  .prepare(
                    "SELECT value FROM task_run_budget_ledger WHERE session_id=? AND run_id=?",
                  )
                  .get(receipt.sessionId, receipt.runId);
                const original = previous
                  ? (JSON.parse(String(previous.value)) as BudgetRunRegistration)
                  : undefined;
                await budgets.register({
                  ...(task ? { taskId: source.id } : {}),
                  ...(goal ? { goalId: source.id } : {}),
                  ...(!task && rootTaskId ? { taskId: rootTaskId } : {}),
                  ...(!goal && rootGoalId ? { goalId: rootGoalId } : {}),
                  role,
                  sessionId: receipt.sessionId,
                  runId: receipt.runId,
                  startedAt: now(),
                  ...pending.spec.workBudgetScope,
                  ...original,
                  workId: work.id,
                  rootWorkId: work.rootWorkId,
                  provider: pending.spec.harness,
                  accountId: pending.spec.providerAccountId ?? "default",
                });
              },
            },
            () =>
              pending.launch(
                {
                  ...pending.spec,
                  requestId: work.requestId,
                  commandIds: {
                    create: commandId(work.requestId, "create"),
                    send: commandId(work.requestId, "send"),
                  },
                },
                async () => {
                  const current = await this.work.get(work.id);
                  return (
                    !current.stopRequested &&
                    current.state !== "completed" &&
                    (await pending.admitted())
                  );
                },
              ),
          );
          if (result.deferred === true && !result.error && !result.runId) {
            const send = await store.receiptStatus(commandId(work.requestId, "send"));
            const current = await this.work.get(work.id);
            if (!send && !current.receipt)
              return {
                deferredBeforeSend: true as const,
                wait: {
                  code: "dependency" as const,
                  message: "Waiting for producer admission before send.",
                },
              };
          }
          if (!result.sessionId || !result.runId)
            throw new Error(result.error ?? "Work launch has no exact receipt.");
          await limits.recordRun(result, now());
          return { sessionId: result.sessionId, runId: result.runId };
        },
        observe: (work) => this.executor(work)?.observe(work) ?? this.observe(work),
        stop: async (work, receipt) => {
          const executor = this.executor(work);
          if (executor) return executor.stop(work, receipt);
          const observed = await this.observe(work);
          if (observed.state === "completed") return;
          if (observed.state === "unknown") throw new Error("Work retirement is unknown.");
          await cancelSessionRun(this.engine, receipt);
        },
        externalRunning: async () =>
          (await store.sessions()).flatMap((run) =>
            run.status === "running" && run.runId
              ? [{ sessionId: run.session.id, runId: run.runId, projectId: run.projectId }]
              : [],
          ),
      },
      limits,
      now,
    );
  }

  /** Exact create command owns preparation; display metadata never establishes identity. */
  private async preparedSession(work: WorkRecord): Promise<string | undefined> {
    const receipt = await this.store.receiptStatus(commandId(work.requestId, "create"));
    if (!receipt) return undefined;
    const spec = work.payload.spec as SessionRunSpec;
    const run = await this.store.session(receipt.sessionId);
    const session = run.session;
    if (
      receipt.runId ||
      run.projectId !== spec.projectId ||
      run.status !== "idle" ||
      run.runId ||
      session.blocks.length ||
      session.busy ||
      session.queuedMessages?.length ||
      session.harness !== spec.harness ||
      session.model !== spec.model ||
      session.runtimeMode !== spec.runtimeMode ||
      session.providerAccountId !== spec.providerAccountId ||
      (spec.workspaceId !== undefined && session.workspaceId !== spec.workspaceId) ||
      (spec.worktreeCwd !== undefined && session.worktreeCwd !== spec.worktreeCwd) ||
      !isDeepStrictEqual(session.modelSettings, spec.modelSettings)
    )
      throw new Error("Work prepared session changed or is active.");
    return receipt.sessionId;
  }

  private async observe(work: WorkRecord) {
    if (!work.receipt) {
      const receipt = await this.store
        .receiptStatus(commandId(work.requestId, "send"))
        .catch(() => undefined);
      if (!receipt?.sessionId || !receipt.runId) return { state: "unknown" as const };
      work = { ...work, receipt: { sessionId: receipt.sessionId, runId: receipt.runId } };
    }
    if (!work.receipt || !this.engine.waitForRun) return { state: "unknown" as const };
    const run = await this.store.session(work.receipt.sessionId).catch(() => undefined);
    if (!run || run.runId !== work.receipt.runId) return { state: "unknown" as const };
    if (run.status === "running") return { state: "running" as const, receipt: work.receipt };
    try {
      await this.engine.waitForRun(work.receipt.sessionId, work.receipt.runId);
    } catch {
      return { state: "unknown" as const };
    }
    if (
      await deferredAssistantTurn(
        this.store,
        work.receipt.sessionId,
        work.receipt.runId,
        work.source.id,
      )
    )
      return {
        state: "completed" as const,
        receipt: work.receipt,
        outcome: {
          status: "cancelled" as const,
          message: "Assistant turn deferred before provider entry.",
        },
      };
    if (run.status === "interrupted") return { state: "unknown" as const };
    const state = await sessionRunState(
      this.store,
      { ...work.receipt, startedAt: work.createdAt },
      0,
      this.now(),
    );
    return state.state === "finished"
      ? {
          state: "completed" as const,
          receipt: work.receipt,
          outcome: { status: state.status, ...(state.error ? { message: state.error } : {}) },
        }
      : { state: "unknown" as const };
  }

  async launch(source: WorkSource, pending: PendingLaunch): Promise<LaunchResult> {
    // Serialize no effects here: shared engine reserves capacity transactionally.
    await this.work.reconcile();
    let spec = pending.spec;
    const target = (value: SessionRunSpec) =>
      JSON.stringify([
        value.projectId,
        value.harness,
        value.providerAccountId,
        value.model,
        value.modelSettings,
        value.runtimeMode,
        value.workspaceId,
        value.worktreeCwd,
        value.resumeSessionId,
      ]);
    const records = await this.work.list();
    let existing = records.find(
      (work) =>
        work.source.kind === source.kind &&
        work.source.id === source.id &&
        work.source.occurrence === source.occurrence,
    );
    // Retain each accepted receipt forever. Only exact known-zero proof plus
    // physical retirement permits a deterministic successor, including restart.
    while (
      existing?.state === "completed" &&
      existing.receipt &&
      !existing.stopRequested &&
      existing.outcome?.message === "Assistant turn deferred before provider entry."
    ) {
      if (target(existing.payload.spec as SessionRunSpec) !== target(spec))
        return { deferred: true };
      const successorSource = {
        ...source,
        occurrence: deferredOccurrence(existing),
      };
      const successor = records.find(
        (work) =>
          work.source.kind === successorSource.kind &&
          work.source.id === successorSource.id &&
          work.source.occurrence === successorSource.occurrence,
      );
      // Existing durable successor already carries the admission proof. Its run
      // may have advanced a resumed session past the original proof snapshot.
      if (
        !successor &&
        (!(await deferredAssistantTurn(
          this.store,
          existing.receipt.sessionId,
          existing.receipt.runId,
          existing.source.id,
        )) ||
          !(await pending.admitted()))
      )
        return { deferred: true };
      source = successorSource;
      existing = successor;
    }
    spec = { ...spec, work: source };
    if (existing) {
      const original = existing.payload.spec as SessionRunSpec;
      let comparable = spec;
      if (
        !original.resumeSessionId &&
        spec.resumeSessionId &&
        !existing.dispatchStarted &&
        !existing.receipt
      ) {
        const prepared = await this.preparedSession(existing).catch(() => undefined);
        if (prepared === spec.resumeSessionId) comparable = { ...spec, resumeSessionId: undefined };
      }
      if (target(original) !== target(comparable)) return { deferred: true };
      // Scheduling ticks may update explanatory prompt context; an accepted
      // occurrence retains the original input and concrete execution snapshot.
      spec = { ...original, work: source };
      pending = { ...pending, spec };
    }
    const payload = {
      projectId: spec.projectId,
      harness: spec.harness,
      providerAccountId: spec.providerAccountId,
      model: spec.model,
      modelSettings: spec.modelSettings,
      runtimeMode: spec.runtimeMode,
      title: spec.title,
      prompt: spec.prompt,
      intent: spec.intent,
      workspaceId: spec.workspaceId,
      workspaceMode: spec.workspaceMode,
      worktreeCwd: spec.worktreeCwd,
      author: spec.author,
      resumeSessionId: spec.resumeSessionId,
      workRootWorkId: spec.workRootWorkId,
      workBudgetScope: spec.workBudgetScope,
    };
    const rootWorkId =
      spec.workRootWorkId ??
      (source.kind.startsWith("task.") || source.kind === "crew.member"
        ? `task:${source.id}`
        : source.kind.startsWith("goal.")
          ? `goal:${source.id}`
          : `${source.kind}:${source.id}`);
    const record = await this.work.submit({
      source,
      projectId: spec.projectId,
      rootWorkId,
      payload: { spec: JSON.parse(JSON.stringify(payload)) },
    });
    if (!this.pending.has(record.id)) this.pending.set(record.id, pending);
    try {
      await this.work.reconcile();
      const current = await this.work.start(record.id).catch(() => this.work.get(record.id));
      if (current.receipt) return current.receipt;
      const prepared =
        !current.dispatchStarted && !current.receipt
          ? await this.preparedSession(current).catch(() => undefined)
          : undefined;
      return {
        ...(prepared ? { sessionId: prepared } : {}),
        deferred: true,
        ...(current.wait ? { wait: current.wait } : {}),
      };
    } finally {
      this.pending.delete(record.id);
    }
  }

  async awaitStoppedTask(taskId: string): Promise<void> {
    for (const work of await this.work.list()) {
      if (
        work.source.id === taskId &&
        (work.source.kind.startsWith("task.") || work.source.kind === "crew.member") &&
        work.receipt
      ) {
        try {
          const session = await this.store.session(work.receipt.sessionId);
          if (work.stopRequested || session.status !== "running")
            await this.engine.waitForRun?.(work.receipt.sessionId, work.receipt.runId);
        } catch {
          throw new Error(
            "The previous task execution is not proven stopped. Retry after it retires.",
          );
        }
      }
    }
  }
}

export function bindSessionWork(
  store: HostStore,
  engine: SessionRunEngine & Partial<Pick<HostEngine, "waitForRun">>,
  limits?: HostLimits,
  now: () => number = Date.now,
): SessionWorkAdapter {
  const existing = runtimes.get(store);
  if (existing) return existing;
  const runtime = new SessionWorkAdapter(store, engine, limits ?? new HostLimits(store, now), now);
  runtimes.set(store, runtime);
  return runtime;
}

export function getSessionWork(store: HostStore): HostWork {
  const runtime = runtimes.get(store);
  if (!runtime) throw new Error("Shared Work admission is unavailable.");
  return runtime.work;
}

export function startSessionWork(store: HostStore): void {
  const runtime = runtimes.get(store);
  if (!runtime) throw new Error("Shared Work admission is unavailable.");
  runtime.start();
}

export function stopSessionWork(store: HostStore): void {
  runtimes.get(store)?.stop();
}

export function registerSessionWorkExecutor(
  store: HostStore,
  key: string,
  executor: RegisteredWorkExecutor,
): HostWork {
  const runtime = runtimes.get(store);
  if (!runtime) throw new Error("Shared Work admission is unavailable.");
  runtime.registerExecutor(key, executor);
  return runtime.work;
}

export function submitSessionWork(
  store: HostStore,
  engine: SessionRunEngine,
  spec: SessionRunSpec,
  admitted: PendingLaunch["admitted"],
  launch: PendingLaunch["launch"],
): Promise<LaunchResult> {
  const runtime =
    runtimes.get(store) ??
    (engine.withCommandAdmission ? bindSessionWork(store, engine) : undefined);
  if (!runtime) return Promise.resolve({ error: "Shared Work admission is unavailable." });
  return runtime.launch(spec.work!, { engine, spec, admitted, launch });
}

/** Composition calls only after every included producer/child has cut over.
 * Existing incomplete calendar windows stay unknown until their reset. */
export async function markSessionWorkCoverage(store: HostStore, since = Date.now()): Promise<void> {
  if (!Number.isFinite(since) || since < 0) throw new Error("Invalid Work coverage boundary.");
  const runtime = runtimes.get(store);
  if (!runtime) throw new Error("Shared Work admission is unavailable.");
  runtime.assertCoverageExecutors();
  await runtime.work.ready;
  await new HostLimits(store).settings();
  await store.db
    .prepare("INSERT OR IGNORE INTO host_settings(key,value) VALUES ('workCoverageSince',?)")
    .run(String(since));
}

/** Stop intent belongs to the exact accepted run, before producer state changes. */
export async function cancelSessionWorkRun(
  store: HostStore,
  receipt: WorkReceipt,
): Promise<boolean> {
  const runtime = runtimes.get(store);
  if (!runtime) return false;
  const work = (await runtime.work.list()).find(
    (item) => item.receipt?.sessionId === receipt.sessionId && item.receipt.runId === receipt.runId,
  );
  if (!work) return false;
  await runtime.work.stop(work.id);
  return true;
}

export async function cancelSessionWorkOccurrence(
  store: HostStore,
  source: WorkSource,
): Promise<void> {
  const runtime = runtimes.get(store);
  if (!runtime) throw new Error("Shared Work admission is unavailable.");
  const records = await runtime.work.list();
  let work = records.find(
    (item) =>
      item.source.kind === source.kind &&
      item.source.id === source.id &&
      item.source.occurrence === source.occurrence,
  );
  while (work?.receipt) {
    const occurrence = deferredOccurrence(work);
    const successor = records.find(
      (item) =>
        item.source.kind === source.kind &&
        item.source.id === source.id &&
        item.source.occurrence === occurrence,
    );
    if (!successor) break;
    work = successor;
  }
  if (work) await runtime.work.stop(work.id);
}

/** Existing Work owns recovery even when its acknowledgement is unknown. */
export async function readSessionWorkReceipt(
  store: HostStore,
  source: WorkSource,
): Promise<{ exists: false } | { exists: true; receipt?: WorkReceipt }> {
  const runtime = runtimes.get(store);
  if (!runtime) throw new Error("Shared Work admission is unavailable.");
  const records = await runtime.work.list();
  let work = records.find(
    (item) =>
      item.source.kind === source.kind &&
      item.source.id === source.id &&
      item.source.occurrence === source.occurrence,
  );
  if (!work) return { exists: false };
  while (work.receipt) {
    const occurrence = deferredOccurrence(work);
    const successor = records.find(
      (item) =>
        item.source.kind === source.kind &&
        item.source.id === source.id &&
        item.source.occurrence === occurrence,
    );
    if (!successor) break;
    work = successor;
  }
  if (work.receipt) return { exists: true, receipt: work.receipt };
  const receipt = await store.receiptStatus(commandId(work.requestId, "send"));
  return receipt?.sessionId && receipt.runId
    ? { exists: true, receipt: { sessionId: receipt.sessionId, runId: receipt.runId } }
    : { exists: true };
}

/** Owner configuration/restart cannot create a fresh identity around unknown work. */
export async function assertTaskWorkRetired(store: HostStore, taskId: string): Promise<void> {
  const runtime = runtimes.get(store);
  if (!runtime) return;
  await runtime.awaitStoppedTask(taskId);
  await runtime.work.reconcile();
  const records = (await runtime.work.list()).filter(
    (work) =>
      work.source.id === taskId &&
      (work.source.kind.startsWith("task.") || work.source.kind === "crew.member"),
  );
  if (records.some((work) => work.reserved || (work.dispatchStarted && work.state !== "completed")))
    throw new Error("The previous task execution is not proven stopped. Retry after it retires.");
}
