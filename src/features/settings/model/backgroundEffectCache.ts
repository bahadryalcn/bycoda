export const BACKGROUND_MAX_EDGE = 2048;
// Preserve the former three full-size source working sets, bounded by actual bytes.
export const BACKGROUND_SOURCE_BYTES = 3 * BACKGROUND_MAX_EDGE ** 2 * 5;
export const BACKGROUND_RENDER_BYTES = 3 * BACKGROUND_MAX_EDGE ** 2 * 4;
const MAX_ENTRIES = 96;

/** Byte LRU for completed values only. Active jobs keep their own exact local value. */
export class BackgroundEffectCache<T> {
  private values = new Map<string, T>();
  private bytes = 0;
  constructor(
    private readonly limit: number,
    private readonly sizeOf: (value: T) => number,
  ) {}
  get(key: string) {
    const value = this.values.get(key);
    if (value !== undefined) {
      this.values.delete(key);
      this.values.set(key, value);
    }
    return value;
  }
  set(key: string, value: T) {
    const old = this.values.get(key);
    if (old !== undefined) this.bytes -= this.sizeOf(old);
    this.values.delete(key);
    this.values.set(key, value);
    this.bytes += this.sizeOf(value);
    for (const [oldest, entry] of this.values) {
      if (this.bytes <= this.limit && this.values.size <= MAX_ENTRIES) break;
      this.values.delete(oldest);
      this.bytes -= this.sizeOf(entry);
    }
  }
  keys() {
    return this.values.keys();
  }
  clear() {
    this.values.clear();
    this.bytes = 0;
  }
  get retainedBytes() {
    return this.bytes;
  }
}
