import { estimateSessionCacheBytes } from "./sessionCache";
import type { PersistedBlock } from "./sessionDelta";

export type PersistenceBaseline = {
  blocks: PersistedBlock[];
  revision?: number;
  updatedAt: number;
  writes: number;
  normalized: boolean;
};

/** Retain CAS stamps even when the immutable block graph is evicted. The next
 * save then makes a guarded full checkpoint, never an unconditional overwrite. */
export class PersistenceBaselines extends Map<string, PersistenceBaseline> {
  private weights = new Map<string, number>();
  private writtenAt = new Map<string, number>();
  private bytes = 0;

  constructor(
    private readonly maxBytes = 32 * 1024 * 1024,
    private readonly limit = 16,
    /** Baselines written this recently belong to sessions that are saving now
     * (live writes run every 1.5 s). Stubbing one forces its next save to send
     * the whole transcript, so two large busy sessions would keep doing that to
     * each other; only colder baselines are evicted. */
    private readonly hotMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {
    super();
  }

  override set(id: string, baseline: PersistenceBaseline): this {
    this.delete(id);
    let weight = 0;
    // Only the sanitized `value` is uniquely retained here; `source` is owned by the
    // live session store, so charging it too would double-count and evict hot sessions.
    for (const block of baseline.blocks) weight += 24 + estimateSessionCacheBytes(block.value);
    super.set(id, baseline);
    this.weights.set(id, weight);
    this.writtenAt.set(id, this.now());
    this.bytes += weight;
    const hotSince = this.now() - this.hotMs;
    // Evict other entries oldest-first. The entry just written is never stubbed; if it
    // alone exceeds the budget, every other entry goes and it stays normalized.
    for (const [key, size] of [...this.weights]) {
      if (this.bytes <= this.maxBytes && this.weights.size <= this.limit) break;
      if (key === id || (this.writtenAt.get(key) ?? 0) > hotSince) continue;
      const entry = super.get(key)!;
      super.set(key, { ...entry, blocks: [], normalized: false });
      this.weights.delete(key);
      this.bytes -= size;
    }
    return this;
  }

  override delete(id: string): boolean {
    this.bytes -= this.weights.get(id) ?? 0;
    this.weights.delete(id);
    this.writtenAt.delete(id);
    return super.delete(id);
  }

  override clear(): void {
    super.clear();
    this.weights.clear();
    this.writtenAt.clear();
    this.bytes = 0;
  }
}
