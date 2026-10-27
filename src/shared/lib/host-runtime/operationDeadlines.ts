import { WS_LIMITS, type ConnectionGeneration } from "../../model/host-contracts";
import { requireBoundedKey, requireSafeCounter, type RuntimeClock } from "./ports";

type Interruption = "cancelled" | "disconnected" | "disposed";
type UncertainReason = Interruption | "timeout";

export type OperationOutcome =
  | { status: "completed"; value: unknown }
  | { status: "failed"; error: unknown }
  | { status: "timed-out"; deadlineAt: number }
  | { status: "cancelled"; reason: Interruption }
  | { status: "uncertain"; commandId: string; reason: UncertainReason };

export type OperationAttempt = {
  requestId: string;
  deadlineAt: number;
  result: Promise<OperationOutcome>;
  cancel(): boolean;
};

export type OperationInput = {
  generation: ConnectionGeneration;
  timeoutMs: number;
} & ({ kind: "query"; cancelQuery?: () => void } | { kind: "mutation"; commandId: string });

type Pending = {
  input: OperationInput;
  deadlineAt: number;
  resolve: (result: OperationOutcome) => void;
  releaseTimer?: () => void;
};

/**
 * One bounded transport attempt ledger, not a durable command store or retry engine.
 * Register immediately before dispatch. Once a mutation may have been submitted, losing
 * its result is uncertainty; cancelling the wait must never claim to undo the command.
 */
export class OperationDeadlines {
  private readonly pending = new Map<string, Pending>();
  private sequence = 0;
  private disposed = false;

  constructor(
    private readonly clock: RuntimeClock,
    private readonly clientId: string,
    private readonly maxPending: number = WS_LIMITS.maxPendingRpc,
  ) {
    requireBoundedKey(clientId, "logical client ID");
    if (clientId.length > 128) throw new Error("Logical client ID is too long");
    if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > WS_LIMITS.maxPendingRpc)
      throw new Error("Invalid pending operation limit");
  }

  get size(): number {
    return this.pending.size;
  }

  begin(input: OperationInput): OperationAttempt {
    if (this.disposed) throw new Error("Operation ledger is disposed");
    if (this.pending.size >= this.maxPending) throw new Error("Pending operation limit reached");
    requireSafeCounter(input.generation, "connection generation");
    if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 180_000)
      throw new Error("Invalid operation deadline");
    if (input.kind === "mutation") requireBoundedKey(input.commandId, "command ID");
    const now = this.clock.now();
    const deadlineAt = now + input.timeoutMs;
    if (!Number.isFinite(now) || now < 0 || deadlineAt > Number.MAX_SAFE_INTEGER)
      throw new Error("Invalid runtime clock");
    if (this.sequence === Number.MAX_SAFE_INTEGER) throw new Error("Operation IDs exhausted");
    const requestId = `${this.clientId}/${input.generation}/${++this.sequence}`;
    let resolve!: Pending["resolve"];
    const result = new Promise<OperationOutcome>((done) => {
      resolve = done;
    });
    const pending: Pending = { input, deadlineAt, resolve };
    this.pending.set(requestId, pending);
    try {
      const release = this.clock.schedule(input.timeoutMs, () => {
        this.interrupt(requestId, pending, "timeout");
      });
      if (this.pending.get(requestId) === pending) pending.releaseTimer = release;
      else release();
    } catch (error) {
      this.pending.delete(requestId);
      throw error;
    }
    return {
      requestId,
      deadlineAt,
      result,
      cancel: () => this.interrupt(requestId, pending, "cancelled"),
    };
  }

  complete(requestId: string, generation: ConnectionGeneration, value: unknown): boolean {
    const pending = this.current(requestId, generation);
    return pending ? this.settle(requestId, pending, { status: "completed", value }) : false;
  }

  /** A known, validated failure response; transport loss must use disconnect instead. */
  fail(requestId: string, generation: ConnectionGeneration, error: unknown): boolean {
    const pending = this.current(requestId, generation);
    return pending ? this.settle(requestId, pending, { status: "failed", error }) : false;
  }

  disconnect(generation: ConnectionGeneration): void {
    for (const [id, pending] of this.pending)
      if (pending.input.generation === generation) this.interrupt(id, pending, "disconnected");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [id, pending] of this.pending) this.interrupt(id, pending, "disposed");
  }

  private current(id: string, generation: ConnectionGeneration): Pending | undefined {
    const pending = this.pending.get(id);
    if (pending?.input.generation !== generation) return undefined;
    // A delayed event loop may deliver a reply before its already-due timer callback.
    if (this.clock.now() >= pending.deadlineAt) {
      this.interrupt(id, pending, "timeout");
      return undefined;
    }
    return pending;
  }

  private interrupt(id: string, pending: Pending, reason: UncertainReason): boolean {
    const input = pending.input;
    const outcome: OperationOutcome =
      input.kind === "mutation"
        ? { status: "uncertain", commandId: input.commandId, reason }
        : reason === "timeout"
          ? { status: "timed-out", deadlineAt: pending.deadlineAt }
          : { status: "cancelled", reason };
    if (!this.settle(id, pending, outcome)) return false;
    // Cancellation is query-only. A submitted mutation is reconciled by command ID.
    if (input.kind === "query") input.cancelQuery?.();
    return true;
  }

  private settle(id: string, pending: Pending, result: OperationOutcome): boolean {
    if (this.pending.get(id) !== pending) return false;
    this.pending.delete(id);
    pending.resolve(result);
    pending.releaseTimer?.();
    return true;
  }
}
