import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
    const measure = () => {
      const next = latest.current.flatMap((item): Spot[] => {
        const element = findUsageGuideTarget([item.target]);
        if (!element) return [];
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
    const frame = window.requestAnimationFrame(measure);
    // Controls move with layout, scrolling and remounts; one slow tick catches the rest.
    const timer = window.setInterval(measure, 1000);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    document.addEventListener("click", seen, true);
    document.addEventListener("focusin", seen, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      document.removeEventListener("click", seen, true);
      document.removeEventListener("focusin", seen, true);
    };
  }, [key]);
  if (!key) return null;
  return createPortal(
    <>
      {spots
        .filter((spot) => pending.some((item) => item.id === spot.id))
        .map((spot) => (
          <span
            key={spot.id}
            className="feature-new-dot"
            aria-hidden="true"
            data-feature-highlight={spot.id}
            style={{ left: spot.x, top: spot.y, zIndex: LAYER.popover }}
          />
        ))}
    </>,
    document.body,
  );
}
