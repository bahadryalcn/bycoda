import { normalizeProjectPath } from "../../projects/public/recents";

/**
 * Hand-arranged order of the sidebar's ungrouped rows, per project. The desktop
 * sidebar applies only `pinned`; `loose` is still stored for other consumers.
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
 * The sidebar's ungrouped rows: pins first in their saved order, then the rest in
 * the given (recency) order, with `compare` (status) leading inside each. The saved
 * `loose` list is not applied, so a past drag cannot freeze the list.
 */
export function orderLooseRows<T extends { id: string; pinned?: boolean }>(
  rows: readonly T[],
  pinnedOrder: readonly string[] | undefined,
  compare: (a: T, b: T) => number,
): T[] {
  return [
    ...applySessionOrder(
      rows.filter((row) => row.pinned),
      pinnedOrder,
    ),
    ...rows.filter((row) => !row.pinned),
  ].sort(compare);
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

/** The last parsed blob: reading every project's order parses the store once. */
let parsedStore: { raw: string; store: Record<string, unknown> } | undefined;

/** A shallow copy: callers replace or delete a project's entry, never edit one in place. */
function parseStore(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(KEY) ?? "{}";
    if (parsedStore?.raw !== raw) {
      const parsed: unknown = JSON.parse(raw);
      parsedStore = {
        raw,
        store:
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {},
      };
    }
    return { ...parsedStore.store };
  } catch {
    return {};
  }
}
