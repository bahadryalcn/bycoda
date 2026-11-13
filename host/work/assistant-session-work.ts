import type { HostEngine } from "../engine";
import type { HostStore } from "../store";
import type { CommandReceipt, HostSession } from "../../src/features/connections/model/protocol";
import type { WorkSource, WorkTarget } from "../../src/shared/model/host-contracts/work";
import { HostTaskBudgets, type BudgetRunRegistration } from "../tasks/task-budgets";
import { HostLimits } from "../limits";
import { sessionRunState } from "../sessions/sessionRuns";
import { bindSessionWork, registerSessionWorkExecutor } from "./session-adapter";
import type { HostWork } from "./service";
import { createHash } from "node:crypto";

type Invocation = {
  admitted: () => Promise<void>;
  run: () => Promise<CommandReceipt>;
  resolve: (receipt: CommandReceipt) => void;
  reject: (error: unknown) => void;
  started: boolean;
};
type Runtime = { work: HostWork; pending: Map<string, Invocation> };
const runtimes = new WeakMap<HostStore, Runtime>();

export function assistantSessionWorkTarget(
  record: HostSession,
  permissionRevision: string,
): WorkTarget {
  const session = record.session;
  return {
    model: {
      harness: session.harness,
      model: session.model,
      modelSettings: session.modelSettings,
      ...(session.providerAccountId ? { providerAccountId: session.providerAccountId } : {}),
    },
    runtimeMode: session.runtimeMode,
    permissionRevision: createHash("sha256").update(permissionRevision).digest("hex"),
    execution: {
      kind: "project",
      projectId: record.projectId,
      ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
      ...(session.worktreeCwd ? { worktreeCwd: session.worktreeCwd } : {}),
    },
  };
}

/** Steering consumes the original physical run; enrolling it must never create a second slot/total. */
export async function enrollAssistantSteerUsage(
  store: HostStore,
  record: HostSession,
  supervisionId: string,
) {
  if (!record.runId) throw new Error("Assistant steering requires the original run identity.");
  const budgets = new HostTaskBudgets(store);
  await budgets.ready;
  await store.transaction(async () => {
    const existing = await store.db
      .prepare("SELECT 1 FROM task_run_budget_ledger WHERE session_id=? AND run_id=?")
      .get(record.session.id, record.runId!);
    if (existing) return;
    const turn = record.session.blocks
      .filter((block) => block.role === "user" && !block.draft && !block.continuationOf)
      .at(-1);
    await budgets.register({
      role: "worker",
      sessionId: record.session.id,
      runId: record.runId!,
      workId: `assistant-manual:${createHash("sha256").update(supervisionId).digest("hex")}`,
      provider: record.session.harness,
      accountId: record.session.providerAccountId ?? "default",
      startedAt: turn?.startedAt ?? record.updatedAt,
    });
  }, "critical");
}

/** Existing Room/manual command gates remain the authority; this executor owns shared capacity. */
type AssistantSessionEngine = Pick<
  HostEngine,
  "command" | "updateSession" | "withCommandAdmission" | "waitForRun"
>;

export function registerAssistantSessionExecutor(
  store: HostStore,
  engine: AssistantSessionEngine,
): Runtime {
  const existing = runtimes.get(store);
  if (existing) return existing;
  bindSessionWork(store, engine);
  const pending = new Map<string, Invocation>();
  const budgets = new HostTaskBudgets(store);
  const limits = new HostLimits(store);
  const work = registerSessionWorkExecutor(store, "assistant-session", {
    admit: async (record) => {
      const invocation = pending.get(record.id);
      if (!invocation)
        return {
          code: "dependency",
          message: "Waiting for the original assistant session authority.",
        };
      try {
        await invocation.admitted();
      } catch (error) {
        invocation.reject(error);
        return {
          code: "permission",
          message: error instanceof Error ? error.message : String(error),
        };
      }
      return undefined;
    },
    resolve: async (record) => ({ target: record.payload.target as WorkTarget }),
    launch: async (record, accepted) => {
      const invocation = pending.get(record.id);
      if (!invocation) throw new Error("Assistant session dispatch is unavailable.");
      invocation.started = true;
      try {
        const receipt = await engine.withCommandAdmission(
          {
            check: async (stage) => {
              if ((await work.get(record.id)).stopRequested)
                throw new Error("Assistant work stopped before send.");
              // Original domain admission owns post-acceptance authority; Room window closure cannot revoke accepted work.
              if (stage.phase === "command") await invocation.admitted();
            },
            onAccepted: async (receipt) => {
              if (!receipt.runId) return;
              await accepted({ sessionId: receipt.sessionId, runId: receipt.runId });
              await budgets.register({
                workId: record.id,
                rootWorkId: record.rootWorkId,
                role: "worker",
                ...(record.payload.budgetScope as
                  | Pick<BudgetRunRegistration, "taskId" | "goalId" | "parentTaskId">
                  | undefined),
                sessionId: receipt.sessionId,
                runId: receipt.runId,
                startedAt: Date.now(),
                provider: record.target!.model.harness,
                accountId: record.target!.model.providerAccountId ?? "default",
              });
              await limits.recordRun(receipt);
            },
          },
          invocation.run,
        );
        if (!receipt.runId) throw new Error("Assistant session send has no exact run receipt.");
        invocation.resolve(receipt);
        return { sessionId: receipt.sessionId, runId: receipt.runId };
      } catch (error) {
        invocation.reject(error);
        throw error;
      }
    },
    observe: async (record) => {
      const receipt =
        record.receipt ?? (await store.receiptStatus(String(record.payload.commandId)));
      if (!receipt?.runId) return { state: "unknown" };
      const exact = { sessionId: receipt.sessionId, runId: receipt.runId };
      const current = await store.session(receipt.sessionId).catch(() => undefined);
      if (!current || current.runId !== receipt.runId || current.status === "interrupted")
        return { state: "unknown" };
      if (current.status === "running") return { state: "running", receipt: exact };
      try {
        await engine.waitForRun(receipt.sessionId, receipt.runId);
      } catch {
        return { state: "unknown" };
      }
      const state = await sessionRunState(
        store,
        { ...exact, startedAt: record.createdAt },
        0,
        Date.now(),
      );
      return state.state === "finished"
        ? {
            state: "completed",
            receipt: exact,
            outcome: { status: state.status, ...(state.error ? { message: state.error } : {}) },
          }
        : { state: "unknown" };
    },
    stop: async (_record, receipt) => {
      await engine.command({
        type: "cancel",
        commandId: `assistant-work-stop:${receipt.runId}`,
        sessionId: receipt.sessionId,
        runId: receipt.runId,
      });
    },
  });
  const runtime = { work, pending };
  runtimes.set(store, runtime);
  return runtime;
}

export async function runAssistantSessionWork(
  store: HostStore,
  engine: AssistantSessionEngine,
  input: {
    source: WorkSource;
    projectId: string;
    target: WorkTarget;
    commandId: string;
    promptHash: string;
    admitted: Invocation["admitted"];
    run: Invocation["run"];
    signal?: AbortSignal;
    budgetScope?: Pick<BudgetRunRegistration, "taskId" | "goalId" | "parentTaskId">;
  },
): Promise<CommandReceipt> {
  const runtime = registerAssistantSessionExecutor(store, engine);
  const record = await runtime.work.submit({
    source: input.source,
    projectId: input.projectId,
    ...(input.budgetScope?.taskId ? { rootWorkId: `task:${input.budgetScope.taskId}` } : {}),
    payload: {
      executor: "assistant-session",
      target: input.target,
      commandId: input.commandId,
      promptHash: input.promptHash,
      ...(input.budgetScope ? { budgetScope: input.budgetScope } : {}),
    },
  });
  const previous = await store.receiptStatus(input.commandId);
  if (previous?.runId) return previous;
  if (runtime.pending.has(record.id))
    throw new Error("Assistant session dispatch is already pending.");
  let resolve!: Invocation["resolve"], reject!: Invocation["reject"];
  const completion = new Promise<CommandReceipt>((done, failed) => {
    resolve = done;
    reject = failed;
  });
  void completion.catch(() => undefined);
  const invocation: Invocation = {
    admitted: input.admitted,
    run: input.run,
    resolve,
    reject,
    started: false,
  };
  const cancel = () => {
    void runtime.work.stop(record.id).catch(() => undefined);
    reject(new Error("Assistant session dispatch cancelled."));
  };
  input.signal?.addEventListener("abort", cancel, { once: true });
  runtime.pending.set(record.id, invocation);
  try {
    input.signal?.throwIfAborted();
    await runtime.work.reconcile();
    const current = await runtime.work.start(record.id);
    if (current.dispatchStarted && !invocation.started)
      throw new Error("Assistant session dispatch outcome is unknown.");
    if (current.state === "completed" && !current.receipt)
      throw new Error("Assistant session dispatch was stopped.");
    return await completion;
  } finally {
    input.signal?.removeEventListener("abort", cancel);
    runtime.pending.delete(record.id);
  }
}
