import { createHash } from "node:crypto";
import type {
  WorkTarget,
  WorkReceipt,
  WorkOutcome,
  WorkSource,
} from "../../src/shared/model/host-contracts/work";
import type { HostStore } from "../store";
import { monotonicNow, elapsedSince } from "../../src/shared/lib/time/timestamps";
import { registerSessionWorkExecutor } from "./session-adapter";
import { registerHelperUsage, settleHelperUsage, type HelperUsageReceipt } from "./helper-usage";
import { HostLimits } from "../limits";
import { admitRunDuration, finishRunDuration } from "../execution/run-duration";

import type {
  ProviderRetirementObserver,
  ProviderRetirementReceipt,
} from "../../src/integrations/harness/core/providerRetirement";

export type HelperResult = { text: string; tokens?: number; contextWindow?: number };
type Pending = {
  signal: AbortSignal;
  controller: AbortController;
  run: (signal?: AbortSignal, retirement?: ProviderRetirementObserver) => Promise<HelperResult>;
  completion: Promise<HelperResult>;
  resolve: (result: HelperResult) => void;
  reject: (error: unknown) => void;
  started: boolean;
};
const runtimes = new WeakMap<HostStore, ReturnType<typeof createRuntime>>();
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

function createRuntime(store: HostStore) {
  const pending = new Map<string, Pending>();
  const limits = new HostLimits(store);
  const ready = store.ready.then(() =>
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS work_helper_runs (work_id TEXT PRIMARY KEY,value TEXT NOT NULL)",
    ),
  );
  const read = async (
    id: string,
  ): Promise<
    { receipt: WorkReceipt; result?: HelperResult; outcome?: WorkOutcome } | undefined
  > => {
    await ready;
    const row = await store.db
      .prepare("SELECT value FROM work_helper_runs WHERE work_id=?")
      .get(id);
    return row ? JSON.parse(String(row.value)) : undefined;
  };
  const work = registerSessionWorkExecutor(store, "assistant-text", {
    admit: async (record) =>
      pending.has(record.id) && !pending.get(record.id)?.signal?.aborted
        ? undefined
        : { code: "dependency", message: "Waiting for the original assistant helper admission." },
    resolve: async (record) => ({ target: record.payload.target as WorkTarget }),
    launch: async (record, accepted) => {
      const invocation = pending.get(record.id);
      if (!invocation) throw new Error("Assistant helper invocation is unavailable.");
      invocation.signal?.throwIfAborted();
      const receipt = {
        sessionId: `assistant-helper:${hash(JSON.stringify([record.source.kind, record.source.id]))}`,
        runId: record.requestId,
      };
      const target = record.target!;
      const usage: HelperUsageReceipt = {
        ...receipt,
        workId: record.id,
        rootWorkId: record.rootWorkId,
        role: "worker",
        provider: target.model.harness,
        accountId: target.model.providerAccountId ?? "default",
        startedAt: Date.now(),
      };
      await admitRunDuration(store, receipt.sessionId, receipt.runId, usage.startedAt);
      await registerHelperUsage(store, usage);
      await accepted(receipt);
      await limits.recordRun(receipt);
      invocation.signal?.throwIfAborted();
      const started = monotonicNow();
      invocation.started = true;
      const original = Symbol(record.id);
      let retirement: ProviderRetirementReceipt | undefined;
      let completed: { result?: HelperResult; outcome: WorkOutcome } | undefined;
      let settlement: Promise<void> | undefined;
      const settle = async () => {
        if (!completed || retirement?.original !== original || !retirement.cleanupSuccess) return;
        if (!settlement) {
          const saved = completed;
          const proof = retirement;
          settlement = store.transaction(async () => {
            await finishRunDuration(store, receipt.sessionId, receipt.runId);
            await settleHelperUsage(store, usage, {
              tokens: proof.dispatch === "not-entered" ? 0 : saved.result?.tokens,
              ...(proof.dispatch === "not-entered" ? { costUsd: 0 } : {}),
              elapsedMs: elapsedSince(started),
              settledAt: Date.now(),
            });
            await ready;
            await store.db
              .prepare("INSERT INTO work_helper_runs(work_id,value) VALUES (?,?)")
              .run(record.id, JSON.stringify({ receipt, ...saved }));
          }, "critical");
        }
        await settlement;
        await work.reconcile();
      };
      const execute = async () => {
        try {
          const result = await invocation.run(invocation.signal, {
            retirementIdentity: original,
            onRetired: async (proof) => {
              if (proof.original !== original) return;
              retirement = proof;
              await settle();
            },
          });
          completed = {
            result,
            outcome: { status: invocation.signal.aborted ? "cancelled" : "succeeded" },
          };
          await settle();
          return result;
        } catch (error) {
          completed = {
            outcome: {
              status: invocation.signal.aborted ? "cancelled" : "failed",
              message: error instanceof Error ? error.message : String(error),
            },
          };
          await settle();
          throw error;
        }
      };
      // Shared scheduling must not wait for a provider turn to finish.
      void execute().then(invocation.resolve, invocation.reject);
      return receipt;
    },
    observe: async (record) => {
      const saved = await read(record.id);
      if (!saved && record.receipt) {
        await limits.recordRun(record.receipt);
        if (pending.get(record.id)?.started) return { state: "running", receipt: record.receipt };
      }
      return saved
        ? {
            state: "completed",
            receipt: saved.receipt,
            outcome: saved.outcome ?? { status: "succeeded" },
          }
        : { state: "unknown" };
    },
    // Stop only this captured invocation; cancellation still leaves retirement unknown.
    stop: async (record) => {
      pending.get(record.id)?.controller.abort();
    },
  });
  return { pending, work, read };
}

/** Host composition registers before waking persisted Work; tests may enter lazily. */
export function registerAssistantHelperExecutor(store: HostStore) {
  let runtime = runtimes.get(store);
  if (!runtime) {
    runtime = createRuntime(store);
    runtimes.set(store, runtime);
  }
  return runtime;
}

/** Exact producer operation, durably proven not sent; absence never proves safety. */
export async function assistantHelperQueuedBeforeSend(
  store: HostStore,
  operationId: string,
  role: string,
) {
  const runtime = registerAssistantHelperExecutor(store);
  const records = (await runtime.work.list()).filter(
    (record) =>
      record.source.kind === "assistant" &&
      record.source.id === role &&
      record.rootWorkId === `assistant:${hash(operationId)}`,
  );
  return (
    records.length === 1 &&
    !records[0]!.dispatchStarted &&
    !records[0]!.receipt &&
    !records[0]!.stopRequested &&
    ["queued", "waiting"].includes(records[0]!.state)
  );
}

/** Uses the same durable Host admission queue as tasks; never replays an uncertain invocation. */
export async function runAssistantHelper(
  store: HostStore,
  input: {
    role: string;
    operationId: string;
    prompt: string;
    target: WorkTarget;
    signal?: AbortSignal;
    source?: WorkSource;
  },
  run: Pending["run"],
): Promise<HelperResult> {
  const runtime = registerAssistantHelperExecutor(store);
  const record = await runtime.work.submit({
    source: input.source
      ? { ...input.source }
      : {
          kind: "assistant",
          id: input.role,
          occurrence: hash(JSON.stringify([input.operationId, input.prompt])),
        },
    rootWorkId: input.source
      ? `${input.source.kind}:${hash(JSON.stringify([input.source.id, input.operationId]))}`
      : `assistant:${hash(input.operationId)}`,
    payload: { executor: "assistant-text", target: input.target, promptHash: hash(input.prompt) },
  });
  const saved = await runtime.read(record.id);
  if (saved) {
    await runtime.work.reconcile();
    if (
      !saved.result ||
      saved.outcome?.status === "failed" ||
      saved.outcome?.status === "cancelled"
    )
      throw new Error(saved.outcome?.message ?? "Assistant helper cancelled.");
    return saved.result;
  }
  if (runtime.pending.has(record.id))
    throw new Error("Assistant helper invocation is already running.");
  const controller = new AbortController();
  const signal = input.signal
    ? AbortSignal.any([input.signal, controller.signal])
    : controller.signal;
  let resolve!: Pending["resolve"], reject!: Pending["reject"];
  const completion = new Promise<HelperResult>((done, failed) => {
    resolve = done;
    reject = failed;
  });
  // A fast provider failure can arrive while the initial durable dispatch still commits.
  void completion.catch(() => undefined);
  const invocation: Pending = {
    signal,
    controller,
    run,
    completion,
    resolve,
    reject,
    started: false,
  };
  const cancel = () => {
    void runtime.work.stop(record.id).catch(() => undefined);
    reject(new Error("Assistant helper cancelled."));
  };
  signal.addEventListener("abort", cancel, { once: true });
  runtime.pending.set(record.id, invocation);
  try {
    if (signal.aborted) cancel();
    await runtime.work.reconcile();
    const current = await runtime.work.start(record.id);
    if (current.dispatchStarted && !invocation.started)
      throw new Error("Assistant helper outcome is unknown; it was not replayed.");
    if (current.state === "completed" && !invocation.started)
      throw new Error("Assistant helper was stopped before dispatch.");
    return await completion;
  } finally {
    signal.removeEventListener("abort", cancel);
    // Fast local rejection can settle while Work is still committing admission.
    // Reconcile after start has returned on both success and failure.
    try {
      await runtime.work.reconcile();
    } finally {
      runtime.pending.delete(record.id);
    }
  }
}
