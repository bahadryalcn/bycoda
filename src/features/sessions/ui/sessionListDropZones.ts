type SessionListHit =
  | { kind: "self" }
  | { kind: "folder"; id: string }
  | { kind: "pinned" }
  | { kind: "card"; id: string; place: "before" | "after"; middle: boolean };

/**
 * Where a dragged session would land, decided from the layout as it was when the drag began. The
 * live list moves apart to open a gap under the pointer, so asking the DOM what is under it would
 * flip the target every time the list shifts; the frozen zones keep the answer stable.
 */
export function snapshotSessionList(scroller: HTMLElement | null) {
  type Zone = { left: number; right: number; top: number; bottom: number };
  const origin = scroller?.getBoundingClientRect();
  const base = scroller?.scrollTop ?? 0;
  const zone = (element: HTMLElement): Zone => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left - (origin?.left ?? 0),
      right: rect.right - (origin?.left ?? 0),
      top: rect.top - (origin?.top ?? 0) + base,
      bottom: rect.bottom - (origin?.top ?? 0) + base,
    };
  };
  const zones = (selector: string, key: "sessionCard" | "sessionFolder") =>
    [...(scroller?.querySelectorAll<HTMLElement>(selector) ?? [])]
      .map((element) => ({ element, id: element.dataset[key] ?? "", zone: zone(element) }))
      .filter((entry) => entry.zone.bottom > entry.zone.top);
  const cards = zones("[data-session-card]", "sessionCard");
  const folders = zones("[data-session-folder]", "sessionFolder");
  const single = (selector: string) => {
    const element = scroller?.querySelector<HTMLElement>(selector);
    return element ? zone(element) : null;
  };
  const pinned = single("[data-pinned-sessions]");
  const reminders = single("[data-reminder-sessions]");
  // The Settled shelf is filed by the Host, so like reminders it takes no drop.
  const settled = single("[data-settled-sessions]");
  const reminderRows = [
    ...(scroller?.querySelectorAll<HTMLElement>(
      '[data-session-section="reminders"], [data-session-section="settled"]',
    ) ?? []),
  ].map(zone);
  return {
    /** The live element of a card, so the list can open a gap beside it. */
    cardElement: (id: string) => cards.find((card) => card.id === id)?.element ?? null,
    hit(x: number, y: number, draggedId: string): SessionListHit | null {
      if (!scroller) return null;
      const box = scroller.getBoundingClientRect();
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) return null;
      const at = y - box.top + scroller.scrollTop;
      // The rows are a pixel or two apart: a hair of slack keeps the pointer from falling between.
      const inside = (z: Zone) =>
        x - box.left >= z.left &&
        x - box.left <= z.right + box.width - (origin?.width ?? box.width) &&
        at >= z.top - 1 &&
        at <= z.bottom + 1;
      if ([reminders, settled].some((z) => z && inside(z)) || reminderRows.some(inside))
        return null;
      const card = cards.find((entry) => inside(entry.zone));
      if (card) {
        if (card.id === draggedId) return { kind: "self" };
        const height = card.zone.bottom - card.zone.top;
        const ratio = height > 0 ? (at - card.zone.top) / height : 0.5;
        return {
          kind: "card",
          id: card.id,
          place: ratio < 0.5 ? "before" : "after",
          middle: ratio > 0.25 && ratio < 0.75,
        };
      }
      // A folder inside the pinned group takes the drop before the group does.
      const folder = folders
        .filter((entry) => inside(entry.zone))
        .sort((a, b) => a.zone.bottom - a.zone.top - (b.zone.bottom - b.zone.top))[0];
      if (folder) return { kind: "folder", id: folder.id };
      return pinned && inside(pinned) ? { kind: "pinned" } : null;
    },
  };
}
