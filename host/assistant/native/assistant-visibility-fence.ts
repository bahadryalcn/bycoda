/**
 * Host-side admission for a native-owned Room visibility snapshot.
 * Callers must authenticate the issuer and serialize its snapshot updates before
 * calling this class. A permit covers the physical effect, not only a DB check.
 */
export type RoomVisibilitySource = Readonly<{
  issuer: string;
  environmentId: string;
  threadId: string;
}>;

export type RoomVisibilityTarget = Readonly<{
  projectId: string;
  cwd: string;
}>;

type Entry = {
  sequence: number;
  source: RoomVisibilitySource;
  targets: Set<string>;
  active: boolean;
  inFlight: number;
  waiters: Array<() => void>;
};

function sourceKey(source: RoomVisibilitySource): string {
  return JSON.stringify([source.issuer, source.environmentId, source.threadId]);
}

function targetKey(target: RoomVisibilityTarget): string {
  return JSON.stringify([target.projectId, target.cwd]);
}

function validSource(source: RoomVisibilitySource): boolean {
  return [source.issuer, source.environmentId, source.threadId].every(
    (part) => !!part && part.length <= 200 && !part.includes("\0"),
  );
}

export class AssistantVisibilityFence {
  private readonly entries = new Map<string, Entry>();
  private epoch = 0;
  private closed = true;

  /** Capture before obtaining a trusted native snapshot, never after the wait. */
  currentEpoch(): number {
    return this.epoch;
  }

  /** Only a fresh, trusted snapshot may reopen admission after revocation drains. */
  register(
    source: RoomVisibilitySource,
    sequence: number,
    targets: readonly RoomVisibilityTarget[],
    epoch: number,
  ): void {
    if (
      !validSource(source) ||
      this.closed ||
      epoch !== this.epoch ||
      !Number.isSafeInteger(sequence) ||
      sequence < 1 ||
      targets.length > 1000 ||
      targets.some(
        (target) =>
          !target.projectId ||
          target.projectId.length > 200 ||
          !target.cwd ||
          target.cwd.length > 4096 ||
          target.cwd.includes("\0"),
      )
    ) {
      throw new Error("Invalid Room visibility registration");
    }
    const key = sourceKey(source);
    const previous = this.entries.get(key);
    if (!previous && this.entries.size >= 1024) throw new Error("Room visibility capacity reached");
    if (previous && (sequence <= previous.sequence || previous.inFlight !== 0)) {
      throw new Error("Stale or undrained Room visibility registration");
    }
    this.entries.set(key, {
      sequence,
      source: { ...source },
      targets: new Set(targets.map(targetKey)),
      active: true,
      inFlight: 0,
      waiters: [],
    });
  }

  /** A privacy change invalidates every window and all snapshots in flight. */
  revokeAll(): Promise<void> {
    this.epoch++;
    this.closed = true;
    const pending: Promise<void>[] = [];
    for (const entry of this.entries.values()) {
      entry.active = false;
      entry.targets.clear();
      if (entry.inFlight) pending.push(new Promise((resolve) => entry.waiters.push(resolve)));
    }
    return Promise.all(pending).then(() => undefined);
  }

  /** Reopen only after the owner commits its privacy change and old work drains. */
  reopen(epoch: number): void {
    if (epoch !== this.epoch || [...this.entries.values()].some((entry) => entry.inFlight !== 0)) {
      throw new Error("Room visibility change is not settled");
    }
    this.closed = false;
  }

  /** Close synchronously; completion means all earlier accepted effects settled. */
  revoke(source: RoomVisibilitySource, sequence: number): Promise<void> {
    const key = sourceKey(source);
    const entry = this.entries.get(key);
    if (
      !validSource(source) ||
      !Number.isSafeInteger(sequence) ||
      sequence < 1 ||
      (entry && sequence <= entry.sequence)
    ) {
      throw new Error("Stale Room visibility revocation");
    }
    if (!entry) {
      if (this.entries.size >= 1024) throw new Error("Room visibility capacity reached");
      this.entries.set(key, {
        sequence,
        source: { ...source },
        targets: new Set(),
        active: false,
        inFlight: 0,
        waiters: [],
      });
      return Promise.resolve();
    }
    entry.sequence = sequence;
    entry.active = false;
    entry.targets.clear();
    if (entry.inFlight === 0) return Promise.resolve();
    return new Promise((resolve) => entry.waiters.push(resolve));
  }

  /** Acquire immediately before admitting the physical effect; always release. */
  acquire(
    source: RoomVisibilitySource,
    target: RoomVisibilityTarget,
  ): { valid: () => boolean; release: () => void } {
    const entry = this.entries.get(sourceKey(source));
    if (!entry?.active || !entry.targets.has(targetKey(target)))
      throw new Error("Room project visibility unavailable");
    return this.acquireEntry(entry);
  }
  /** Global Room source permit, with no fabricated project target. */
  acquireSource(source: RoomVisibilitySource): { valid: () => boolean; release: () => void } {
    const entry = this.entries.get(sourceKey(source));
    if (!entry?.active) throw new Error("Room source visibility unavailable");
    return this.acquireEntry(entry);
  }
  private acquireEntry(entry: Entry): { valid: () => boolean; release: () => void } {
    const generation = entry.sequence;
    entry.inFlight++;
    let released = false;
    return {
      valid: () => !released && entry.active && entry.sequence === generation,
      release: () => {
        if (released) return;
        released = true;
        entry.inFlight--;
        if (entry.inFlight === 0) for (const resolve of entry.waiters.splice(0)) resolve();
      },
    };
  }
}
