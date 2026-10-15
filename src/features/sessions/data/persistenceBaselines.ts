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
  private bytes = 0;

  constructor(
    private readonly maxBytes = 32 * 1024 * 1024,
    private readonly limit = 16,
  ) {
    super();
  }

  override set(id: string, baseline: PersistenceBaseline): this {
    this.delete(id);
    let weight = 0;
    for (const block of baseline.blocks) {
      // Immutable blocks reuse their weakly cached estimate on later deltas.
      weight += 24 + estimateSessionCacheBytes(block.source);
      if (block.value !== block.source) weight += estimateSessionCacheBytes(block.value);
    }
    super.set(id, baseline);
    this.weights.set(id, weight);
    this.bytes += weight;
    for (const [key, size] of this.weights) {
      if (this.bytes <= this.maxBytes && this.weights.size <= this.limit) break;
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
    return super.delete(id);
  }

  override clear(): void {
    super.clear();
    this.weights.clear();
    this.bytes = 0;
  }
}
