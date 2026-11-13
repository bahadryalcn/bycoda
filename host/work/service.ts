import { isDeepStrictEqual } from "node:util";
import {
  WorkOutcomeSchema,
  WorkReceiptSchema,
  WorkTargetSchema,
  WorkWaitSchema,
  type WorkOutcome,
  type WorkReceipt,
  type WorkRecord,
  type WorkSubmission,
  type WorkWait,
} from "../../src/shared/model/host-contracts/work";
import type { HostStore } from "../store";
import type { WorkCallbacks } from "./contracts";
import { reserveWork, type WorkHostLimits } from "./scheduler";
import { WorkStorage } from "./storage";

/** Shared durable admission. Domain services retain projections and existing permission gates. */
export class HostWork {
  readonly ready: Promise<void>;
  private readonly storage: WorkStorage;
  private readonly launches = new Map<string, Promise<WorkRecord>>();
  private ticking?: Promise<void>;

  constructor(
    store: HostStore,
    private readonly callbacks: WorkCallbacks,
    private readonly limits: WorkHostLimits,
    now: () => number = Date.now,
  ) {
    this.storage = new WorkStorage(store, now);
    this.ready = this.storage.ready;
  }

  submit(input: WorkSubmission): Promise<WorkRecord> {
    return this.storage.submit(input);
  }
  get(id: string): Promise<WorkRecord> {
    return this.storage.get(id);
  }
  list(): Promise<WorkRecord[]> {
    return this.storage.list();
  }

  /** Dispatch only queued/waiting work. Unknown reservations are never replayed. */
  start(id: string): Promise<WorkRecord> {
    const current = this.launches.get(id);
    if (current) return current;
    const launch = this.dispatch(id).finally(() => {
      this.launches.delete(id);
    });
    this.launches.set(id, launch);
    return launch;
  }

  /** Host timer/domain tick owns wakeups; no competing timer or provider retry loop. */
  tick(): Promise<void> {
    this.ticking ??= this.schedule().finally(() => {
      this.ticking = undefined;
    });
    return this.ticking;
  }

  private async schedule(): Promise<void> {
    for (const work of await this.list()) {
      if (work.state === "queued" || work.state === "waiting") await this.start(work.id);
    }
  }

  private async update(id: string, change: (work: WorkRecord) => WorkRecord): Promise<WorkRecord> {
    await this.ready;
    return this.storage.store.transaction(
      async () => this.storage.save(change(await this.get(id))),
      "critical",
    );
  }

  private async waiting(id: string, reason: WorkWait): Promise<WorkRecord> {
    const wait = WorkWaitSchema.parse(reason);
    return this.update(id, (work) => {
      if (work.dispatchStarted || work.state === "completed") return work;
      return { ...work, state: "waiting", reserved: false, target: undefined, wait };
    });
  }

  private async accepted(id: string, raw: WorkReceipt): Promise<WorkRecord> {
    const receipt = WorkReceiptSchema.parse(raw);
    return this.update(id, (work) => {
      if (!work.dispatchStarted || !work.target) throw new Error("Work has no dispatched target.");
      if (work.receipt && !isDeepStrictEqual(work.receipt, receipt))
        throw new Error("Work run receipt cannot change.");
      if (work.state === "completed") return work;
      return { ...work, receipt, state: "running", reserved: true };
    });
  }

  private async dispatch(id: string): Promise<WorkRecord> {
    const reservation = await reserveWork(this.storage, this.limits, this.callbacks, id);
    if (!reservation.claimed) return reservation.work;
    try {
      const reason = await this.callbacks.admit?.(reservation.work);
      if (reason) return this.waiting(id, reason);
      const resolved = await this.callbacks.resolve(await this.get(id));
      if ("wait" in resolved) return this.waiting(id, resolved.wait);
      const target = WorkTargetSchema.parse(resolved.target);
      if (
        target.execution.kind === "project" &&
        target.execution.projectId !== reservation.work.projectId
      ) {
        throw new Error("Work target must retain its submitted project.");
      }
      if (target.execution.kind === "room" && reservation.work.projectId !== undefined) {
        throw new Error("Project work cannot become a Room run.");
      }
      const prepared = await this.update(id, (work) => {
        if (work.stopRequested || work.state === "completed") return work;
        return { ...work, target };
      });
      if (prepared.stopRequested || prepared.state === "completed") return prepared;
      // Recheck authority/caps after model/workspace preparation, at the effect boundary.
      const denied = await this.callbacks.admit?.(prepared);
      if (denied) return this.waiting(id, denied);
      const fresh = await this.update(id, (work) => {
        if (work.stopRequested || work.state === "completed") return work;
        return { ...work, dispatchStarted: true };
      });
      if (!fresh.dispatchStarted) return fresh;
      const receipt = await this.callbacks.launch(fresh, async (accepted) => {
        const current = await this.accepted(id, accepted);
        if (current.stopRequested) throw new Error("Work stopped before provider admission.");
      });
      if ("deferredBeforeSend" in receipt) {
        const wait = WorkWaitSchema.parse(receipt.wait);
        return this.update(id, (work) => {
          // An accepted receipt always wins over a contradictory helper result.
          if (work.receipt || work.state === "completed") return work;
          if (work.stopRequested)
            return {
              ...work,
              state: "completed",
              reserved: false,
              dispatchStarted: false,
              outcome: { status: "cancelled" },
              wait: undefined,
            };
          return { ...work, state: "waiting", reserved: false, dispatchStarted: false, wait };
        });
      }
      const running = await this.accepted(id, receipt);
      if (running.stopRequested) await this.callbacks.stop(running, receipt);
      return this.get(id);
    } catch (error) {
      const work = await this.get(id);
      if (!work.dispatchStarted) {
        // No provider effect was possible; release preparation reservation, retain explicit wait.
        await this.waiting(id, {
          code: "configuration",
          message: error instanceof Error ? error.message : String(error),
        });
      } else {
        await this.update(id, (current) =>
          current.state === "completed"
            ? current
            : {
                ...current,
                state: "unknown",
                reserved: true,
              },
        );
      }
      throw error;
    }
  }

  /** Call only with exact-run settlement AND physical retirement proof. */
  async complete(
    id: string,
    rawReceipt: WorkReceipt,
    rawOutcome: WorkOutcome,
  ): Promise<WorkRecord> {
    const receipt = WorkReceiptSchema.parse(rawReceipt);
    const outcome = WorkOutcomeSchema.parse(rawOutcome);
    return this.update(id, (work) => {
      if (!work.receipt || !isDeepStrictEqual(work.receipt, receipt))
        throw new Error("Work completion receipt mismatch.");
      if (work.state === "completed") {
        if (!isDeepStrictEqual(work.outcome, outcome))
          throw new Error("Work outcome cannot change.");
        return work;
      }
      return { ...work, state: "completed", reserved: false, outcome, wait: undefined };
    });
  }

  async stop(id: string): Promise<WorkRecord> {
    const work = await this.update(id, (current) => {
      if (current.state === "completed") return current;
      if (!current.dispatchStarted)
        return {
          ...current,
          stopRequested: true,
          state: "completed",
          reserved: false,
          outcome: { status: "cancelled" },
          wait: undefined,
        };
      return { ...current, stopRequested: true };
    });
    if (work.state !== "completed" && work.receipt) await this.callbacks.stop(work, work.receipt);
    return this.get(id);
  }

  /** Run before waking producers after restart. No missing ACK is treated as a failed launch. */
  async reconcile(): Promise<void> {
    for (const item of await this.list()) {
      if (!item.reserved || this.launches.has(item.id)) continue;
      if (!item.dispatchStarted) {
        await this.update(item.id, (work) => ({ ...work, state: "queued", reserved: false }));
        continue;
      }
      const observation = await this.callbacks.observe(item);
      if (observation.state === "unknown") {
        await this.update(item.id, (work) =>
          work.state === "completed" ? work : { ...work, state: "unknown" },
        );
        continue;
      }
      const work = await this.accepted(item.id, observation.receipt);
      if (observation.state === "completed")
        await this.complete(item.id, observation.receipt, observation.outcome);
      else if (work.stopRequested) await this.callbacks.stop(work, observation.receipt);
    }
  }
}
