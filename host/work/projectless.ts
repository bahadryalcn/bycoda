import { ModelRoutingTargetSchema } from "../../src/shared/model/host-contracts/model-routing";
import type {
  WorkOutcome,
  WorkReceipt,
  WorkRecord,
  WorkTarget,
} from "../../src/shared/model/host-contracts/work";
import type { HostStore } from "../store";
import { registerHelperUsage, settleHelperUsage, type HelperUsageReceipt } from "./helper-usage";
import { registerSessionWorkExecutor } from "./session-adapter";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import type { RoomAutomationSources } from "../automations/room-tools";

/** Delivery must be idempotent for the exact occurrence and preserve Room provenance. */
export type RoomAutomationPorts = {
  globalRoomBinding(): Promise<{ id: string } | null>;
  /** Resolves only after physical retirement; rejection leaves ownership unknown. */
  execute(input: {
    workId?: string;
    threadId: string;
    occurrence: string;
    prompt: string;
    target: WorkTarget;
    authorized: () => Promise<boolean>;
  }): Promise<{
    text: string;
    tokens?: number;
    costUsd?: number;
    outcome?: WorkOutcome;
    sources?: RoomAutomationSources;
  }>;
  /** Requests cancellation of this exact invocation; does not establish retirement. */
  stop(occurrence: string): Promise<void>;
  deliver(
    threadId: string,
    occurrence: string,
    text: string,
    authorized: () => Promise<boolean>,
    sources?: RoomAutomationSources,
  ): Promise<void>;
};

type Invocation = {
  workId: string;
  threadId: string;
  receipt: WorkReceipt;
  startedAt: number;
  state: "running" | "completed";
  stopped?: boolean;
  outcome?: WorkOutcome;
  result?: {
    text: string;
    tokens?: number;
    costUsd?: number;
    settledAt: number;
    elapsedMs: number;
    outcome?: WorkOutcome;
    sources?: RoomAutomationSources;
  };
};

/** One executor in the existing Host Work runtime; no project identity is fabricated. */
export function registerRoomAutomationExecutor(store: HostStore, ports: RoomAutomationPorts) {
  const ready = store.ready.then(() =>
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS room_work_invocations (work_id TEXT PRIMARY KEY, value TEXT NOT NULL)",
    ),
  );
  const read = async (id: string): Promise<Invocation | undefined> => {
    await ready;
    const row = await store.db
      .prepare("SELECT value FROM room_work_invocations WHERE work_id=?")
      .get(id);
    return row ? (JSON.parse(String(row.value)) as Invocation) : undefined;
  };
  const write = async (value: Invocation) => {
    await store.db
      .prepare(
        "INSERT INTO room_work_invocations VALUES (?,?) ON CONFLICT(work_id) DO UPDATE SET value=excluded.value",
      )
      .run(value.workId, JSON.stringify(value));
  };
  const active = new Set<string>();
  const usageReceipt = (work: WorkRecord, invocation: Invocation): HelperUsageReceipt => ({
    ...invocation.receipt,
    workId: work.id,
    role: "worker",
    startedAt: invocation.startedAt,
    provider: work.target!.model.harness,
    accountId: work.target!.model.providerAccountId ?? "default",
  });
  const run = async (work: WorkRecord, invocation: Invocation, usage: HelperUsageReceipt) => {
    if (active.has(work.id)) return;
    active.add(work.id);
    try {
      await finish(work, invocation, usage);
    } finally {
      active.delete(work.id);
    }
  };
  const finish = async (work: WorkRecord, invocation: Invocation, usage: HelperUsageReceipt) => {
    const started = monotonicNow();
    let outcome: WorkOutcome;
    let tokens: number | undefined;
    let costUsd: number | undefined;
    try {
      const target = work.target!;
      const result =
        invocation.result ??
        (await ports.execute({
          workId: work.id,
          threadId: invocation.threadId,
          occurrence: work.source.occurrence,
          target,
          prompt: String(work.payload.prompt),
          authorized: async () => {
            const fresh = await read(work.id);
            return (
              !!fresh &&
              !fresh.stopped &&
              (await ports.globalRoomBinding())?.id === invocation.threadId
            );
          },
        }));
      tokens = result.tokens;
      costUsd = result.costUsd;
      // Retain provider result before delivery. Restart retries this exact output,
      // never a second provider invocation under the original occurrence.
      if (!invocation.result) {
        const settledAt = Date.now();
        invocation = await store.transaction(async () => {
          const current = await read(work.id);
          if (!current) throw new Error("Room invocation disappeared.");
          const value = {
            ...current,
            result: {
              ...result,
              outcome: result.outcome ?? { status: "succeeded" as const },
              settledAt,
              elapsedMs: elapsedSince(started),
            },
          };
          await write(value);
          return value;
        }, "critical");
      }
      // Provider retirement owns usage settlement; a later lost delivery ACK does not undo it.
      const measurement = invocation.result!;
      await settleHelperUsage(store, usage, {
        tokens,
        costUsd,
        elapsedMs: measurement.elapsedMs,
        settledAt: measurement.settledAt,
      });
      const current = await read(work.id);
      if (!current) throw new Error("Room invocation disappeared.");
      if (current.stopped) outcome = { status: "cancelled" };
      else if (result.outcome && result.outcome.status !== "succeeded") outcome = result.outcome;
      else {
        if ((await ports.globalRoomBinding())?.id !== invocation.threadId)
          throw new Error("Room identity or authority changed before delivery.");
        await ports.deliver(
          invocation.threadId,
          work.source.occurrence,
          result.text,
          async () => {
            const fresh = await read(work.id);
            return (
              !!fresh &&
              !fresh.stopped &&
              (await ports.globalRoomBinding())?.id === invocation.threadId
            );
          },
          result.sources,
        );
        outcome = { status: "succeeded" };
      }
    } catch (error) {
      // A rejected provider or delivery call does not prove retirement or delivery outcome.
      console.error("Room automation outcome is unknown:", error);
      return;
    }
    const finalOutcome = await store.transaction(async () => {
      const current = await read(work.id);
      if (!current) throw new Error("Room invocation disappeared.");
      const result: WorkOutcome = current.stopped ? { status: "cancelled" } : outcome;
      await write({ ...current, state: "completed", outcome: result });
      return result;
    }, "critical");
    await runtime.complete(work.id, invocation.receipt, finalOutcome);
  };
  const runtime = registerSessionWorkExecutor(store, "room-automation", {
    admit: async (work) => {
      if (
        work.projectId ||
        work.source.kind !== "automation" ||
        typeof work.payload.prompt !== "string" ||
        !work.payload.prompt.trim()
      )
        return { code: "configuration", message: "Invalid projectless automation input." };
      const room = await ports.globalRoomBinding();
      if (
        !room ||
        (work.target?.execution.kind === "room" && work.target.execution.threadId !== room.id)
      )
        return { code: "permission", message: "The registered Room is unavailable." };
      return undefined;
    },
    resolve: async (work) => {
      const room = await ports.globalRoomBinding();
      if (!room)
        return { wait: { code: "permission", message: "The registered Room is unavailable." } };
      const model = ModelRoutingTargetSchema.parse(work.payload.model);
      return {
        target: {
          model,
          runtimeMode: "supervised",
          permissionRevision: work.requestId,
          execution: { kind: "room", threadId: room.id },
        },
      };
    },
    launch: async (work, accepted) => {
      if (work.target?.execution.kind !== "room") throw new Error("Room target is missing.");
      const receipt = {
        sessionId: `room-helper:${work.id}`,
        runId: `room-invocation:${work.requestId}`,
      };
      const invocation: Invocation = {
        workId: work.id,
        threadId: work.target.execution.threadId,
        receipt,
        startedAt: Date.now(),
        state: "running",
      };
      const usage = usageReceipt(work, invocation);
      if (await read(work.id)) throw new Error("Room invocation already exists.");
      await write(invocation);
      await registerHelperUsage(store, usage);
      await accepted(receipt);
      void run(work, invocation, usage).catch((error) =>
        console.error("Room automation settlement failed:", error),
      );
      return receipt;
    },
    observe: async (work) => {
      let value = await read(work.id);
      if (value?.state === "running" && value.result && !active.has(work.id)) {
        await run(work, value, usageReceipt(work, value));
        value = await read(work.id);
      }
      if (!value || value.state !== "completed" || !value.outcome) return { state: "unknown" };
      return { state: "completed", receipt: value.receipt, outcome: value.outcome };
    },
    stop: async (work, receipt) => {
      await store.transaction(async () => {
        const value = await read(work.id);
        if (
          !value ||
          value.receipt.sessionId !== receipt.sessionId ||
          value.receipt.runId !== receipt.runId
        )
          throw new Error("Room invocation identity changed.");
        await write({ ...value, stopped: true });
      }, "critical");
      await ports.stop(work.source.occurrence);
    },
  });
  return runtime;
}
