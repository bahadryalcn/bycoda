export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items;
  }
  const next = items.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export type MoveStep = "up" | "down" | "top";

/**
 * Moves `id` one place up or down, or to the front. Ids outside `movable` are
 * stepped over, so a hidden neighbour never swallows a step. Returns the same
 * array when nothing can move.
 */
export function moveIdByStep(
  ids: string[],
  id: string,
  step: MoveStep,
  movable?: ReadonlySet<string>,
): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  if (step === "top") return moveItem(ids, from, 0);
  const direction = step === "up" ? -1 : 1;
  for (let to = from + direction; to >= 0 && to < ids.length; to += direction) {
    if (!movable || movable.has(ids[to])) return moveItem(ids, from, to);
  }
  return ids;
}

export function orderByIds<T extends { id: string }>(items: T[], ids: string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const next: T[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const item = byId.get(id);
    if (!item || seen.has(id)) continue;
    seen.add(id);
    next.push(item);
  }
  for (const item of items) {
    if (!seen.has(item.id)) next.push(item);
  }
  return next;
}

/** Replace only the slots occupied by a reordered subset, preserving other items. */
export function mergeOrderedSubset<T extends { id: string }>(items: T[], orderedSubset: T[]): T[] {
  const subsetIds = new Set(orderedSubset.map((item) => item.id));
  if (subsetIds.size !== orderedSubset.length) return items;

  const itemIds = new Set(items.map((item) => item.id));
  if (orderedSubset.some((item) => !itemIds.has(item.id))) return items;

  let subsetIndex = 0;
  return items.map((item) => (subsetIds.has(item.id) ? orderedSubset[subsetIndex++] : item));
}
