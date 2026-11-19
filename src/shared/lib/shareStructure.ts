const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const itemId = (value: unknown): string | undefined =>
  isPlainObject(value) && typeof value.id === "string" ? value.id : undefined;

/**
 * Returns `next` with every part that equals `previous` by value replaced by
 * `previous`'s own object, and `previous` itself when nothing differs. Freshly
 * parsed host data therefore keeps stable references for unchanged slices, so
 * `===` checks, selectors and memoised work only see the entries that changed.
 * Arrays of `{ id }` objects are matched by id, so inserting or reordering an
 * entry does not discard the sharing of the rest. Handles JSON-shaped data
 * (plain objects, arrays, primitives); anything else is compared with `Object.is`.
 */
export function shareStructure<T>(previous: unknown, next: T): T {
  if (Object.is(previous, next)) return next;
  if (Array.isArray(next)) {
    if (!Array.isArray(previous)) return next;
    const byId = new Map<string, unknown>();
    for (const item of previous) {
      const id = itemId(item);
      if (id !== undefined && !byId.has(id)) byId.set(id, item);
    }
    let same = previous.length === next.length;
    const merged = next.map((item, index) => {
      const id = itemId(item);
      const before = id !== undefined && byId.has(id) ? byId.get(id) : previous[index];
      const kept = shareStructure(before, item);
      if (kept !== previous[index]) same = false;
      return kept;
    });
    return (same ? previous : merged) as T;
  }
  if (isPlainObject(next)) {
    if (!isPlainObject(previous)) return next;
    const keys = Object.keys(next);
    let same = keys.length === Object.keys(previous).length;
    const merged: Record<string, unknown> = {};
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(previous, key)) same = false;
      const kept = shareStructure(previous[key], next[key]);
      if (kept !== previous[key]) same = false;
      merged[key] = kept;
    }
    return (same ? previous : merged) as T;
  }
  return next;
}
