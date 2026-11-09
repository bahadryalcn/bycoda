/** Same idle retention limits as useGitResource. Required owners may exceed them. */
export const CHECKOUT_CACHE_ENTRIES = 96;
export const CHECKOUT_CACHE_BYTES = 16 * 1024 * 1024;

function retainedBytes(value: unknown): number {
  let bytes = 0,
    remaining = 50_000;
  const pending: unknown[] = [value];
  const seen = new Set<object>();
  while (pending.length) {
    if (--remaining < 0) return CHECKOUT_CACHE_BYTES + 1;
    const item = pending.pop();
    if (typeof item === "string") bytes += item.length * 2;
    else if (item && typeof item === "object") {
      if (seen.has(item)) continue;
      seen.add(item);
      bytes += 32;
      const add = (child: unknown) => {
        if (pending.length >= remaining) return false;
        pending.push(child);
        return true;
      };
      if (item instanceof Map) {
        for (const [key, child] of item)
          if (!add(key) || !add(child)) return CHECKOUT_CACHE_BYTES + 1;
      } else if (item instanceof Set || Array.isArray(item)) {
        for (const child of item) if (!add(child)) return CHECKOUT_CACHE_BYTES + 1;
      } else {
        for (const key in item)
          if (
            Object.prototype.hasOwnProperty.call(item, key) &&
            !add((item as Record<string, unknown>)[key])
          )
            return CHECKOUT_CACHE_BYTES + 1;
      }
    } else bytes += 8;
    if (bytes > CHECKOUT_CACHE_BYTES) return bytes;
  }
  return bytes;
}

/** Evict cached presentation only. Subscribers, original flights and drafts pin owners. */
export class CheckoutCache<K, V> extends Map<K, V> {
  private sizes = new Map<K, number>();
  private leases = new Map<K, number>();
  private bytes = 0;
  constructor(
    private readonly protectedValue: (value: V) => boolean = () => false,
    private readonly payload: (value: V) => unknown = (value) => value,
  ) {
    super();
  }
  override get(key: K): V | undefined {
    if (!super.has(key)) return undefined;
    const value = super.get(key)!;
    super.delete(key);
    super.set(key, value);
    return value;
  }
  override set(key: K, value: V): this {
    this.bytes -= this.sizes.get(key) ?? 0;
    const size =
      retainedBytes(this.payload(value)) + (typeof key === "string" ? key.length * 2 : 16);
    this.sizes.set(key, size);
    this.bytes += size;
    super.delete(key);
    super.set(key, value);
    this.prune(key);
    return this;
  }
  refresh(key: K) {
    const value = super.get(key);
    if (value !== undefined) this.set(key, value);
  }
  retain(key: K): () => void {
    this.leases.set(key, (this.leases.get(key) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = (this.leases.get(key) ?? 1) - 1;
      if (count) this.leases.set(key, count);
      else this.leases.delete(key);
      this.prune();
    };
  }
  prune(protectedKey?: K) {
    for (const [key, value] of this) {
      if (this.size <= CHECKOUT_CACHE_ENTRIES && this.bytes <= CHECKOUT_CACHE_BYTES) break;
      if (
        (key === protectedKey && (this.sizes.get(key) ?? 0) <= CHECKOUT_CACHE_BYTES) ||
        this.leases.has(key) ||
        this.protectedValue(value)
      )
        continue;
      this.bytes -= this.sizes.get(key) ?? 0;
      this.sizes.delete(key);
      super.delete(key);
    }
  }
  override clear() {
    super.clear();
    this.sizes.clear();
    this.bytes = 0;
  }
  override delete(key: K) {
    this.bytes -= this.sizes.get(key) ?? 0;
    this.sizes.delete(key);
    return super.delete(key);
  }
}
