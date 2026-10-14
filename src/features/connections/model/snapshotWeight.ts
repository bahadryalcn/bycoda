/** Conservative retained-data estimate without serializing the transcript. */
const weights = new WeakMap<object, number>();
export function snapshotWeight(value: unknown): number {
  const seen = new WeakSet<object>();
  const visit = (item: unknown): number => {
    if (typeof item === "string") return item.length * 2 + 24;
    if (item === null || typeof item !== "object") return 8;
    if (seen.has(item)) return 0;
    seen.add(item);
    const cached = weights.get(item);
    if (cached !== undefined) return cached;
    let bytes = 32;
    for (const [key, child] of Object.entries(item)) bytes += key.length * 2 + visit(child);
    weights.set(item, bytes);
    return bytes;
  };
  return visit(value);
}
