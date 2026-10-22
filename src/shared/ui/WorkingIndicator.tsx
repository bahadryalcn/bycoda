import { useEffect, useRef } from "react";
import styles from "./WorkingIndicator.module.css";

/** Bar centers on the original 24-unit grid. */
const BARS = [4.5, 9.5, 14.5, 19.5];

const OFFSCREEN_ATTRIBUTE = "data-offscreen";
let sharedObserver: IntersectionObserver | null | undefined;

/**
 * One observer for every indicator. It only toggles an attribute that the CSS
 * module uses to pause the loop, so scrolling never re-renders React. Elements in
 * display:none report as not intersecting, which also pauses them.
 */
function offscreenObserver(): IntersectionObserver | null {
  if (sharedObserver !== undefined) return sharedObserver;
  sharedObserver =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) entry.target.removeAttribute(OFFSCREEN_ATTRIBUTE);
            else entry.target.setAttribute(OFFSCREEN_ATTRIBUTE, "true");
          }
        });
  return sharedObserver;
}

/**
 * Decorative working signal. The enclosing status owns its accessible label.
 * Only the root animates (opacity): animated SVG children and per-bar
 * animations kept the main thread rendering every frame, see the CSS module.
 * The root pauses while it is outside the viewport (shared observer).
 */
export function WorkingIndicator({
  className = "inline-block w-3.5 shrink-0",
}: {
  className?: string;
}) {
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = root.current;
    const observer = offscreenObserver();
    if (!element || !observer) return;
    observer.observe(element);
    return () => {
      observer.unobserve(element);
      element.removeAttribute(OFFSCREEN_ATTRIBUTE);
    };
  }, []);
  return (
    <span ref={root} aria-hidden="true" className={`${styles.indicator} ${className}`}>
      <span className={styles.grid}>
        {BARS.map((x) => (
          <span key={x} className={styles.bar} style={{ left: `${((x - 1.3) / 24) * 100}%` }} />
        ))}
      </span>
    </span>
  );
}
