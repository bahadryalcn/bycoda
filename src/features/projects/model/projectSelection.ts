import { pathKey } from "../../../shared/lib/paths";

export function selectProjectRange(
  order: readonly string[],
  selected: ReadonlySet<string>,
  anchor: string | null,
  target: string,
  range: boolean,
): Set<string> {
  const next = new Set(selected);
  const end = order.findIndex((path) => pathKey(path) === pathKey(target));
  const start = anchor == null ? -1 : order.findIndex((path) => pathKey(path) === pathKey(anchor));
  if (range && start >= 0 && end >= 0) {
    for (const path of order.slice(Math.min(start, end), Math.max(start, end) + 1))
      next.add(pathKey(path));
  } else {
    const key = pathKey(target);
    if (next.has(key)) next.delete(key);
    else next.add(key);
  }
  return next;
}

/** Move selected runs one row, independently inside each displayed section. */
export function moveSelectedProjects(
  order: readonly string[],
  buckets: readonly (readonly string[])[],
  selected: ReadonlySet<string>,
  step: -1 | 1,
): string[] {
  const next = [...order];
  for (const bucket of buckets) {
    const keys = new Set(bucket.map(pathKey));
    const slots = next.flatMap((path, index) => (keys.has(pathKey(path)) ? [index] : []));
    const rows = slots.map((index) => next[index]);
    const picked = (index: number) => selected.has(pathKey(rows[index]));
    if (step === -1) {
      for (let i = 1; i < rows.length; i++) {
        if (picked(i) && !picked(i - 1)) [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]];
      }
    } else {
      for (let i = rows.length - 2; i >= 0; i--) {
        if (picked(i) && !picked(i + 1)) [rows[i], rows[i + 1]] = [rows[i + 1], rows[i]];
      }
    }
    slots.forEach((slot, index) => {
      next[slot] = rows[index];
    });
  }
  return next;
}
