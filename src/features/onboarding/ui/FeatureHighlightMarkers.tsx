import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Portal } from "../../../shared/ui/Portal";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { LAYER } from "../../../shared/lib/layers";
import { markHighlightSeen } from "../model/featureHighlights";
import { usePendingHighlights } from "../model/useFeatureHighlights";
import { findUsageGuideTarget } from "../model/usageGuideTargets";
import "./featureHighlights.css";

type Spot = { id: string; x: number; y: number };

const sameSpots = (a: readonly Spot[], b: readonly Spot[]) =>
  a.length === b.length &&
  a.every((spot, i) => spot.id === b[i].id && spot.x === b[i].x && spot.y === b[i].y);

/**
 * A small "New" dot on the control of every highlight added since the user last updated.
 * The dot never changes layout (it is positioned over the control) and disappears once the
 * control is clicked or focused, or the "What's new" tour has shown it.
 */
export function FeatureHighlightMarkers() {
  const pending = usePendingHighlights();
  const key = pending.map((item) => item.id).join("|");
  const latest = useRef(pending);
  useLayoutEffect(() => {
    latest.current = pending;
  });
  const [spots, setSpots] = useState<readonly Spot[]>([]);
  useEffect(() => {
    if (!key) return;
    // The controls found by the last measure, so a scroll can tell without
    // reading layout whether it moved any of them.
    const located = new Map<string, Element>();
    const measure = () => {
      located.clear();
      const next = latest.current.flatMap((item): Spot[] => {
        const element = findUsageGuideTarget([item.target]);
        if (!element) return [];
        located.set(item.id, element);
        const rect = element.getBoundingClientRect();
        return [{ id: item.id, x: Math.round(rect.right), y: Math.round(rect.top) }];
      });
      setSpots((previous) => (sameSpots(previous, next) ? previous : next));
    };
    const seen = (event: Event) => {
      if (!(event.target instanceof Node)) return;
      for (const item of latest.current) {
        if (findUsageGuideTarget([item.target])?.contains(event.target)) markHighlightSeen(item.id);
      }
    };
    // Scrolling anywhere fires this, and measuring reads layout: coalesce the
    // events to one read per frame, and read nothing while the window is hidden.
    let frame = 0;
    const schedule = () => {
      if (frame || document.hidden) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    schedule();
    // Controls move with layout, scrolling and remounts; one slow tick catches the rest.
    const timer = window.setInterval(schedule, 1000);
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("resize", schedule);
    const onScroll = (event: Event) => {
      const source = event.target;
      if (source instanceof Element && located.size === latest.current.length) {
        let moves = false;
        for (const element of located.values()) {
          if (source.contains(element)) {
            moves = true;
            break;
          }
        }
        if (!moves) return;
      }
      schedule();
    };
    window.addEventListener("scroll", onScroll, true);
    document.addEventListener("click", seen, true);
    document.addEventListener("focusin", seen, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("click", seen, true);
      document.removeEventListener("focusin", seen, true);
    };
  }, [key]);
  if (!key) return null;
  // Markers are DOM decorations anchored to arbitrary elements of the app, not a shared overlay.
  return (
    <Portal target={document.body}>
      {spots
        .filter((spot) => pending.some((item) => item.id === spot.id))
        .map((spot) => (
          <StatusDot
            key={spot.id}
            appearance="attention"
            className="feature-new-dot"
            aria-hidden="true"
            data-feature-highlight={spot.id}
            style={
              {
                "--highlight-x": `${spot.x}px`,
                "--highlight-y": `${spot.y}px`,
                "--highlight-layer": LAYER.popover,
              } as CSSProperties
            }
          />
        ))}
    </Portal>
  );
}
