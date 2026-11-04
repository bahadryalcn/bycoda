import { createHash } from "node:crypto";

const DEFAULT_BYTES = 1024 * 1024;
const PROBES = 4;

/**
 * Conservative, process-lifetime admission fence for expired mutation receipts.
 * A match may be a false positive and must refuse execution. Added keys have no
 * false negatives: this filter is never cleared or rotated during its lifetime.
 * Stop admitting new requests at saturation; existing exact receipts remain usable.
 */
export class RetiredRequestFence {
  private readonly bits: Uint8Array;
  private occupied = 0;

  constructor(bytes = DEFAULT_BYTES) {
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > DEFAULT_BYTES)
      throw new Error("Invalid retired request fence size");
    this.bits = new Uint8Array(bytes);
  }

  get saturated(): boolean {
    return this.occupied >= (this.bits.length * 8) / 4;
  }

  has(key: string): boolean {
    return this.positions(key).every((bit) => (this.bits[bit >>> 3] & (1 << (bit & 7))) !== 0);
  }

  add(key: string): void {
    for (const bit of this.positions(key)) {
      const offset = bit >>> 3;
      const mask = 1 << (bit & 7);
      if ((this.bits[offset] & mask) === 0) {
        this.bits[offset] |= mask;
        this.occupied++;
      }
    }
  }

  private positions(key: string): number[] {
    const digest = createHash("sha256").update(key).digest();
    return Array.from(
      { length: PROBES },
      (_, index) => digest.readUInt32BE(index * 4) % (this.bits.length * 8),
    );
  }
}
