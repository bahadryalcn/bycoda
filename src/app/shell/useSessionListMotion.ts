import { useLayoutEffect, useRef, type RefObject } from "react";
import { decorativeMotionEnabled } from "../../features/settings/model/decorativeMotion";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";

/** Which rows were already listed, so only a later arrival grows in. */
export type SessionInsertMotion = { cwd: string; since: number; seen: Set<string> };

/**
 * Session list motion. `captureListMotion` records the cards' positions just
 * before a drop or undo reorders them, and the next layout glides each moved
 * card from there to its place. `insertMotion` tracks which rows have been
 * listed, so a session that arrives afterwards slides in.
 */
export function useSessionListMotion(
  scrollRef: RefObject<HTMLElement | null>,
  cwd: string,
  listedSessions: readonly SessionSummary[],
) {
  const pendingRects = useRef<Map<string, DOMRect> | null>(null);
  const captureListMotion = () => {
    const root = scrollRef.current;
    if (!root || !decorativeMotionEnabled()) return;
    const rects = new Map<string, DOMRect>();
    for (const card of root.querySelectorAll<HTMLElement>("[data-session-card]")) {
      rects.set(card.dataset.sessionCard!, card.getBoundingClientRect());
    }
    pendingRects.current = rects;
  };
  useLayoutEffect(() => {
    const before = pendingRects.current;
    const root = scrollRef.current;
    if (!before || !root) return;
    pendingRects.current = null;
    for (const card of root.querySelectorAll<HTMLElement>("[data-session-card]")) {
      const from = before.get(card.dataset.sessionCard!);
      if (!from || typeof card.animate !== "function") continue;
      const dy = from.top - card.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) continue;
      card.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], {
        duration: 220,
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      });
    }
  });

  const insertMotion = useRef<SessionInsertMotion>({
    cwd: "",
    since: Date.now(),
    seen: new Set(),
  });
  // Runs after the rows' mount effects: a project's first paint never animates,
  // and rows that mount later (drawer opened, folder expanded) are not new.
  useLayoutEffect(() => {
    const motion = insertMotion.current;
    if (motion.cwd !== cwd) {
      motion.cwd = cwd;
      motion.since = Date.now();
      motion.seen.clear();
    }
    for (const session of listedSessions) motion.seen.add(session.id);
    while (motion.seen.size > 2048) {
      const oldest = motion.seen.values().next().value;
      if (oldest === undefined) break;
      motion.seen.delete(oldest);
    }
  }, [cwd, listedSessions]);

  return { captureListMotion, insertMotion };
}
