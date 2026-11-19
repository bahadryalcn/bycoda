/** A subscription control waited its admission time and no slot opened. Nothing ran. */
export class ControlLaneBusy extends Error {}

/**
 * One socket's lane for subscription open, ack and close. Acks are O(1) and bursts of opens follow
 * every reconnect, so a request beyond the slots waits in a bounded FIFO queue instead of failing.
 * Only a full queue refuses at ingress (`reserve` returns undefined) and only a wait past its
 * admission time fails (`ControlLaneBusy`). Both happen before any effect, so the client may retry.
 *
 * The lane never owns a deadline: the caller passes the request's own signal, so the original
 * deadline and a socket close keep governing a request while it waits. Every reserved lease is
 * released exactly once by the caller; release frees its slot or queue place and its order turn.
 */
export class ControlLane {
  private held = 0;
  private reserved = 0;
  private readonly queue: ControlLease[] = [];
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly slots: number,
    private readonly queued: number,
  ) {
    if (!Number.isSafeInteger(slots) || slots < 1 || !Number.isSafeInteger(queued) || queued < 0)
      throw new Error("Invalid control lane limits.");
  }

  /** Leases not yet released: running and waiting. The socket's other controls are counted apart. */
  get outstanding(): number {
    return this.reserved;
  }

  /** Synchronous, so the decision precedes the caller's first await. Arrival order is kept. */
  reserve(): ControlLease | undefined {
    if (this.reserved >= this.slots + this.queued) return undefined;
    const lease = new ControlLease(this, this.tail);
    this.tail = lease.turn;
    this.reserved++;
    if (this.held < this.slots && this.queue.length === 0) this.held++;
    else this.queue.push(lease);
    return lease;
  }

  /** @internal Called by a lease only. */
  free(lease: ControlLease): void {
    this.reserved--;
    const index = this.queue.indexOf(lease);
    if (index >= 0) this.queue.splice(index, 1);
    else this.held--;
    while (this.held < this.slots && this.queue.length > 0) {
      this.held++;
      this.queue.shift()!.grant();
    }
  }

  /** @internal Whether the lease still waits for a slot. */
  waiting(lease: ControlLease): boolean {
    return this.queue.includes(lease);
  }
}

export class ControlLease {
  /** Settles when this lease is released; the next arrival's effect waits on it. */
  readonly turn: Promise<void>;
  private finishTurn!: () => void;
  private released = false;
  private onGrant?: () => void;

  /** @internal Created by `ControlLane.reserve`. */
  constructor(
    private readonly lane: ControlLane,
    private readonly previous: Promise<void>,
  ) {
    this.turn = new Promise<void>((resolve) => (this.finishTurn = resolve));
  }

  /** @internal */
  grant(): void {
    this.onGrant?.();
  }

  /**
   * Resolves once a slot is held. Rejects with the signal's reason when the request is cancelled or
   * expires while queued, or with `ControlLaneBusy` after `admissionMs`. The queue place is given
   * back at once; the caller still releases the lease.
   */
  held(signal: AbortSignal, admissionMs: number): Promise<void> {
    if (this.released) return Promise.reject(new Error("Control lane lease released."));
    if (signal.aborted) return Promise.reject(signal.reason);
    if (!this.lane.waiting(this)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const stop = (failure: unknown) => {
        cleanup();
        // A cancelled or expired request must not hold up the requests queued behind it.
        this.release();
        reject(failure);
      };
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", aborted);
        this.onGrant = undefined;
      };
      const aborted = () => stop(signal.reason);
      const timer = setTimeout(
        () => stop(new ControlLaneBusy("Control lane admission timed out.")),
        admissionMs,
      );
      timer.unref();
      signal.addEventListener("abort", aborted, { once: true });
      this.onGrant = () => {
        cleanup();
        resolve();
      };
    });
  }

  /**
   * Resolves after every earlier arrival has finished, so open, ack and close for one
   * subscription take effect in arrival order even though their checks overlap.
   */
  ordered(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise<void>((resolve, reject) => {
      const aborted = () => reject(signal.reason);
      signal.addEventListener("abort", aborted, { once: true });
      void this.previous.then(() => {
        signal.removeEventListener("abort", aborted);
        resolve();
      });
    });
  }

  /** Idempotent. */
  release(): void {
    if (this.released) return;
    this.released = true;
    this.lane.free(this);
    this.finishTurn();
  }
}
