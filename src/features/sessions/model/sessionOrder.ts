import { normalizeProjectPath } from "../../projects/model/recents";

/**
 * Hand-arranged order of the sidebar's ungrouped rows, per project. A list
 * follows recency until the user first drags inside it; from then on its
 * saved order wins and sessions it has not seen yet (new ones) lead it.
 */
export type SessionOrderList = "loose" | "pinned";
export type SessionOrder = Partial<Record<SessionOrderList, string[]>>;
export type SessionDropPlace = "before" | "after";

const KEY = "bycoda.sessionOrder";

export function applySessionOrder<T extends { id: string }>(
  items: readonly T[],
  order: readonly string[] | undefined,
): T[] {
  if (!order?.length) return [...items];
  const rank = new Map(order.map((id, index) => [id, index]));
  const fresh = items.filter((item) => !rank.has(item.id));
  const known = items
    .filter((item) => rank.has(item.id))
    .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...fresh, ...known];
}

/**
 * Moves `ids` next to `anchorId` in `base`, keeping their relative order.
 * Placement is relative to a session, never an index, so rows hidden by a
 * filter or search keep their places. An unknown anchor appends.
 */
export function moveIdsInOrder(
  base: readonly string[],
  ids: readonly string[],
  anchorId: string,
  place: SessionDropPlace,
): string[] {
  const moving = [...new Set(ids)].filter((id) => id !== anchorId);
  const movingSet = new Set(moving);
  const rest = base.filter((id) => !movingSet.has(id));
  const at = rest.indexOf(anchorId);
  if (at < 0) return [...rest, ...moving];
  const index = place === "after" ? at + 1 : at;
  return [...rest.slice(0, index), ...moving, ...rest.slice(index)];
}

export function loadSessionOrder(cwd: string): SessionOrder {
  const key = storageKey(cwd);
  if (!key) return {};
  const value = parseStore()[key];
  if (!value || typeof value !== "object") return {};
  const out: SessionOrder = {};
  for (const list of ["loose", "pinned"] as const) {
    const ids = (value as Record<string, unknown>)[list];
    if (Array.isArray(ids)) {
      out[list] = [...new Set(ids.filter((id): id is string => typeof id === "string" && !!id))];
    }
  }
  return out;
}

export function saveSessionOrder(cwd: string, order: SessionOrder): void {
  const key = storageKey(cwd);
  if (!key) return;
  try {
    const store = parseStore();
    if (!order.loose?.length && !order.pinned?.length) delete store[key];
    else store[key] = order;
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // private mode / quota: the order lasts for this run only
  }
}

function storageKey(cwd: string): string | null {
  if (!cwd || cwd === "~") return null;
  return normalizeProjectPath(cwd);
}

function parseStore(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { ...(parsed as Record<string, unknown>) }
      : {};
  } catch {
    return {};
  }
}
