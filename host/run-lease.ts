import {
  LeaseHeldError,
  LeaseLostError,
  RUN_LEASE_TTL_MS,
  type RunLease,
} from "../src/features/sync/model/runLease";

/**
 * Which desktop window runs a turn of which conversation, as the home host
 * knows it. In memory on purpose: a lease lasts one heartbeat window, a
 * restarted host learns the busy ones from the next beat, and `epoch` is
 * clock-based so a window that comes back after a restart is still fenced.
 * The host's own turns need no lease; the engine's running status is the proof.
 */
export class RunLeases {
  /** Conversations a host can have leases for at once; far above what one person runs. */
  static readonly MAX = 1024;
  private readonly leases = new Map<string, RunLease>();
  /** When each live lease was first granted (a renewal keeps it). */
  private readonly grantedAt = new Map<string, number>();
  private epoch = 0;
  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttl: number = RUN_LEASE_TTL_MS,
  ) {}

  /** The live lease of a conversation. */
  holder(sessionId: string): RunLease | undefined {
    const lease = this.leases.get(sessionId);
    if (!lease) return undefined;
    if (lease.expiresAt > this.now()) return lease;
    this.forget(sessionId);
    return undefined;
  }

  /**
   * Grants `holder` the lease, or renews it for the same holder (the same epoch).
   * `blockedBy` names a side that runs the conversation without a lease (the
   * host's own turn, an older desktop); it keeps the lease from being granted.
   */
  acquire(sessionId: string, holder: string, blockedBy?: () => string | undefined): RunLease {
    const current = this.holder(sessionId);
    if (current && current.holder !== holder) throw new LeaseHeldError(current.holder);
    if (current) return this.extend(sessionId, current);
    const other = blockedBy?.();
    if (other) throw new LeaseHeldError(other);
    if (this.leases.size >= RunLeases.MAX) {
      this.takeExpired();
      if (this.leases.size >= RunLeases.MAX)
        throw new Error("Too many conversations are running in bycoda apps at once.");
    }
    const lease = {
      holder,
      epoch: Math.max(this.epoch + 1, this.now()),
      expiresAt: this.now() + this.ttl,
    };
    this.epoch = lease.epoch;
    this.leases.set(sessionId, lease);
    this.grantedAt.set(sessionId, this.now());
    return lease;
  }

  /**
   * The holder's heartbeat reported the conversation busy: the lease lives on.
   * A holder that names the epoch it believes it has only renews that one.
   */
  renew(sessionId: string, holder: string, epoch?: number): RunLease | undefined {
    const current = this.holder(sessionId);
    if (current?.holder !== holder || (epoch !== undefined && current.epoch !== epoch))
      return undefined;
    return this.extend(sessionId, current);
  }

  /**
   * The holder's turn ended. A holder that comes back with an older epoch has
   * lost the lease and must re-read the conversation instead of writing to it.
   */
  release(sessionId: string, holder: string, epoch?: number): boolean {
    const current = this.holder(sessionId);
    if (!current || current.holder !== holder) {
      if (epoch !== undefined && current) throw new LeaseLostError();
      return false;
    }
    if (epoch !== undefined && current.epoch !== epoch) throw new LeaseLostError();
    this.forget(sessionId);
    return true;
  }

  /**
   * Drops the lease of `sessionId` that `holder` has, because the turn it was
   * busy with ended. With `heldBefore` only a lease granted by then goes: one
   * granted afterwards belongs to a newer turn that has not reported busy yet.
   */
  drop(sessionId: string, holder: string, heldBefore?: number): boolean {
    const current = this.leases.get(sessionId);
    if (current?.holder !== holder) return false;
    if (heldBefore !== undefined && (this.grantedAt.get(sessionId) ?? 0) > heldBefore) return false;
    this.forget(sessionId);
    return true;
  }

  private forget(sessionId: string): void {
    this.leases.delete(sessionId);
    this.grantedAt.delete(sessionId);
  }

  /** Earliest expiry of a live lease, for the single timer that looks again then. */
  nextExpiry(): number | undefined {
    let earliest: number | undefined;
    for (const lease of this.leases.values())
      earliest = Math.min(earliest ?? lease.expiresAt, lease.expiresAt);
    return earliest;
  }

  /** Conversations whose lease ran out; they are forgotten. */
  takeExpired(): string[] {
    const ids: string[] = [];
    for (const [id, lease] of this.leases)
      if (lease.expiresAt <= this.now()) {
        ids.push(id);
        this.forget(id);
      }
    return ids;
  }

  private extend(sessionId: string, lease: RunLease): RunLease {
    const renewed = { ...lease, expiresAt: this.now() + this.ttl };
    this.leases.set(sessionId, renewed);
    return renewed;
  }
}
