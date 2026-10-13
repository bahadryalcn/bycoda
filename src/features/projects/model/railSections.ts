import { moveIdByStep, type MoveStep } from "../../../shared/lib/reorder";
import { notifyProjectPathsChanged, subscribeProjectPathsChanged } from "./recents";

const SECTION_ORDER_KEY = "bycoda.projectRailSectionOrder";

/** The rail's reorderable sections, in their default order. */
export const RAIL_SECTION_IDS = ["last-sessions", "pinned", "groups", "projects"] as const;

export type RailSectionId = (typeof RAIL_SECTION_IDS)[number];

export const RAIL_SECTION_LABELS: Record<RailSectionId, string> = {
  "last-sessions": "Last sessions",
  pinned: "Pinned",
  groups: "Groups",
  projects: "Projects",
};

const KNOWN = new Set<string>(RAIL_SECTION_IDS);

/**
 * A stored order made safe: unknown ids and repeats are dropped, and sections
 * the list does not mention (added in a newer version) are appended in their
 * default order.
 */
export function normalizeRailSectionOrder(stored: unknown): RailSectionId[] {
  const out: RailSectionId[] = [];
  const seen = new Set<string>();
  if (Array.isArray(stored)) {
    for (const id of stored) {
      if (typeof id !== "string" || !KNOWN.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id as RailSectionId);
    }
  }
  for (const id of RAIL_SECTION_IDS) if (!seen.has(id)) out.push(id);
  return out;
}

/** Moves one section a step, jumping over sections that are not on screen. */
export function moveRailSection(
  order: readonly RailSectionId[],
  id: RailSectionId,
  step: MoveStep,
  shown?: ReadonlySet<RailSectionId>,
): RailSectionId[] {
  return moveIdByStep([...order], id, step, shown) as RailSectionId[];
}

/**
 * Applies a drag of the sections on screen to the full order. Sections that
 * are hidden keep their slot, so they come back where the user left them.
 */
export function applyShownSectionOrder(
  order: readonly RailSectionId[],
  shownOrder: readonly RailSectionId[],
): RailSectionId[] {
  const shown = new Set(shownOrder);
  if (shown.size !== shownOrder.length) return [...order];
  let next = 0;
  return order.map((id) => (shown.has(id) ? (shownOrder[next++] ?? id) : id));
}

export function loadRailSectionOrder(): RailSectionId[] {
  try {
    const raw = localStorage.getItem(SECTION_ORDER_KEY);
    return normalizeRailSectionOrder(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeRailSectionOrder(null);
  }
}

export function saveRailSectionOrder(order: readonly RailSectionId[]): void {
  try {
    localStorage.setItem(SECTION_ORDER_KEY, JSON.stringify(normalizeRailSectionOrder(order)));
  } catch {
    // private mode / quota
  }
  notifyProjectPathsChanged();
}

export function resetRailSectionOrder(): void {
  try {
    localStorage.removeItem(SECTION_ORDER_KEY);
  } catch {
    // private mode / quota
  }
  notifyProjectPathsChanged();
}

export function isDefaultRailSectionOrder(order: readonly RailSectionId[]): boolean {
  return order.every((id, index) => id === RAIL_SECTION_IDS[index]);
}

/** Fires for a change made here, and for one made by another window. */
export function subscribeRailSectionOrder(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SECTION_ORDER_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  const unsubscribe = subscribeProjectPathsChanged(onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    unsubscribe();
  };
}
