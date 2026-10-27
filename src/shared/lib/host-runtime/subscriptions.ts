import {
  WS_LIMITS,
  type ConnectionGeneration,
  type StreamCursor,
} from "../../model/host-contracts";
import { requireBoundedKey, requireSafeCounter, type RuntimeScope } from "./ports";

export type SubscriptionScope = RuntimeScope & { streamId: string; filterKey: string };
export type SubscriptionLease = { readonly id: number; readonly key: string; release(): void };
export type ApplicationResult =
  | { status: "applied" | "duplicate" | "stale" | "closed" }
  | {
      status: "resync-required";
      reason: "snapshot-required" | "cursor-gap" | "overlap" | "application-failed";
      error?: unknown;
    };
export type CursorCommit = (input: {
  cursor: StreamCursor;
  /** Install data and this cursor together; check inside that bounded transaction. */
  isCurrent(): boolean;
}) => void | Promise<void>;

type Consumer = {
  cursor?: StreamCursor;
  needsSnapshot: boolean;
  version: number;
  flight?: object;
};
type Entry = {
  scope: SubscriptionScope;
  consumers: Map<number, Consumer>;
  closed: boolean;
};

/** Lossless scope identity; raw filter parameters belong in the validated transport adapter. */
export function subscriptionScopeKey(scope: SubscriptionScope): string {
  const fields = [
    scope.environmentId,
    scope.principalId,
    scope.accessEpoch,
    scope.streamId,
    scope.filterKey,
  ];
  for (const field of fields) requireBoundedKey(field, "subscription scope");
  return JSON.stringify(fields);
}

/** Logical demand and per-consumer applied cursors, never a socket or reconnect owner. */
export class SubscriptionRegistry {
  private readonly entries = new Map<string, Entry>();
  private generation: ConnectionGeneration = 0;
  private sequence = 0;
  private consumerCount = 0;

  constructor(private readonly maxConsumers: number = WS_LIMITS.maxSubscriptionsPerSocket) {
    if (!Number.isSafeInteger(maxConsumers) || maxConsumers < 1)
      throw new Error("Invalid subscription consumer limit");
  }

  retain(scope: SubscriptionScope): SubscriptionLease {
    if (this.consumerCount >= this.maxConsumers)
      throw new Error("Subscription consumer limit reached");
    const key = subscriptionScopeKey(scope);
    let entry = this.entries.get(key);
    if (entry?.closed) throw new Error("Subscription scope was invalidated");
    if (!entry) {
      if (this.entries.size >= WS_LIMITS.maxSubscriptionsPerSocket)
        throw new Error("Subscription limit reached");
      entry = { scope: { ...scope }, consumers: new Map(), closed: false };
      this.entries.set(key, entry);
    }
    if (this.sequence === Number.MAX_SAFE_INTEGER) throw new Error("Subscription IDs exhausted");
    const id = ++this.sequence;
    entry.consumers.set(id, { needsSnapshot: true, version: 0 });
    this.consumerCount++;
    return {
      id,
      key,
      release: () => {
        if (!entry.consumers.delete(id)) return;
        this.consumerCount--;
        if (!entry.consumers.size) this.entries.delete(key);
      },
    };
  }

  setGeneration(generation: ConnectionGeneration): boolean {
    requireSafeCounter(generation, "connection generation");
    if (generation <= this.generation) return false;
    this.generation = generation;
    for (const entry of this.entries.values())
      for (const consumer of entry.consumers.values()) {
        consumer.version++;
        consumer.flight = undefined;
      }
    return true;
  }

  appliedCursor(lease: SubscriptionLease): StreamCursor | undefined {
    const cursor = this.consumer(lease)?.cursor;
    return cursor ? { ...cursor } : undefined;
  }

  /** Stop a superseded application while retaining its last committed cursor. */
  interrupt(lease: SubscriptionLease): void {
    const consumer = this.consumer(lease);
    if (!consumer) return;
    consumer.version++;
    consumer.flight = undefined;
    consumer.needsSnapshot = true;
  }

  demands(): Array<{ key: string; scope: SubscriptionScope; consumers: number }> {
    return [...this.entries.entries()]
      .filter(([, entry]) => !entry.closed)
      .map(([key, entry]) => ({ key, scope: { ...entry.scope }, consumers: entry.consumers.size }));
  }

  /** Deletion/revocation drops applied cursors and stops demand until leases are released. */
  invalidate(scope: SubscriptionScope): void {
    const entry = this.entries.get(subscriptionScopeKey(scope));
    if (!entry) return;
    entry.closed = true;
    for (const consumer of entry.consumers.values()) {
      consumer.cursor = undefined;
      consumer.needsSnapshot = true;
      consumer.version++;
      consumer.flight = undefined;
    }
  }

  applySnapshot(
    lease: SubscriptionLease,
    generation: ConnectionGeneration,
    cursor: StreamCursor,
    commit: CursorCommit,
  ): Promise<ApplicationResult> {
    return this.apply(lease, generation, cursor, commit, true);
  }

  applyDelta(
    lease: SubscriptionLease,
    generation: ConnectionGeneration,
    cursor: StreamCursor,
    commit: CursorCommit,
  ): Promise<ApplicationResult> {
    return this.apply(lease, generation, cursor, commit, false);
  }

  private consumer(lease: SubscriptionLease): Consumer | undefined {
    const entry = this.entries.get(lease.key);
    return entry && !entry.closed ? entry.consumers.get(lease.id) : undefined;
  }

  private async apply(
    lease: SubscriptionLease,
    generation: ConnectionGeneration,
    cursor: StreamCursor,
    commit: CursorCommit,
    snapshot: boolean,
  ): Promise<ApplicationResult> {
    requireSafeCounter(cursor.sequence, "stream sequence");
    requireBoundedKey(cursor.epoch, "stream epoch");
    const consumer = this.consumer(lease);
    if (!consumer) return { status: "closed" };
    if (generation !== this.generation) return { status: "stale" };
    if (consumer.flight) {
      consumer.version++;
      consumer.needsSnapshot = true;
      return { status: "resync-required", reason: "overlap" };
    }
    const previous = consumer.cursor;
    if (!snapshot) {
      if (consumer.needsSnapshot || !previous)
        return { status: "resync-required", reason: "snapshot-required" };
      if (cursor.epoch !== previous.epoch || cursor.sequence > previous.sequence + 1) {
        consumer.needsSnapshot = true;
        return { status: "resync-required", reason: "cursor-gap" };
      }
      if (cursor.sequence <= previous.sequence) return { status: "duplicate" };
    } else if (previous?.epoch === cursor.epoch && cursor.sequence < previous.sequence) {
      return { status: "stale" };
    }
    const flight = {};
    const version = ++consumer.version;
    consumer.flight = flight;
    const isCurrent = () =>
      this.consumer(lease) === consumer &&
      this.generation === generation &&
      consumer.version === version;
    try {
      await commit({ cursor: { ...cursor }, isCurrent });
      if (!isCurrent()) return { status: "stale" };
      consumer.cursor = { ...cursor };
      consumer.needsSnapshot = false;
      return { status: "applied" };
    } catch (error) {
      if (!isCurrent()) return { status: "stale" };
      consumer.needsSnapshot = true;
      return { status: "resync-required", reason: "application-failed", error };
    } finally {
      if (consumer.flight === flight) consumer.flight = undefined;
    }
  }
}
