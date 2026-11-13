import { useEffect, useRef, type ReactNode } from "react";
import { Text, type TextRoles } from "./Text";
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

export type WorkingIndicatorSize = "xs" | "sm" | "md";

/**
 * Working signal, decorative by default: the enclosing status owns its accessible
 * label, so there is one live signal. Pass `label` only when nothing else near it
 * announces the activity; it then becomes a polite status with hidden text.
 * The component owns its color (`--color-active`) and its size (`size` follows the
 * shared icon scale, so it swaps with `icon-xs|sm|md` status icons without shifting
 * layout). Consumers pass only placement through `className`; text color, width
 * and display utilities have no effect.
 * Under reduced motion or with decorative motion off the bars stay visible and still.
 * Only the root animates (opacity): animated SVG children and per-bar
 * animations kept the main thread rendering every frame, see the CSS module.
 * The root pauses while it is outside the viewport (shared observer).
 * @group feedback
 * @use Compact "agent is working" signal beside a session, row or status line.
 * @avoid Generic loading or a pending button: Spinner. Measurable progress: Progress. Unknown pane load: SurfaceLoading.
 */
export function WorkingIndicator({
  className = "",
  label,
  size = "xs",
  variant = "bars",
  children,
  text,
  truncate,
  glyph = true,
}: {
  /** Placement only (margins, alignment). Toggle visibility on a wrapper; color and size belong to the component. */
  className?: string;
  /** Visible agent-work label; the enclosing activity owns live announcements. */
  children?: ReactNode;
  /** Typography of the label, never the glyph. */
  text?: TextRoles;
  truncate?: boolean;
  /** Omit the glyph only when the same row already renders its working mark. */
  glyph?: boolean;
  /** Announces the activity politely. Omit it when a nearby status already does. */
  label?: string;
  /** Matches the shared icon scale: xs 12px (default), sm 14px, md 16px. */
  size?: WorkingIndicatorSize;
  /** A 6px dot for dense session status slots; bars retain the shared icon size. */
  variant?: "bars" | "dot";
}) {
  const root = useRef<HTMLSpanElement>(null);
  // Pause the shared working animation while its signal is outside the viewport.
  useEffect(() => {
    const element = root.current;
    const observer = offscreenObserver();
    if (!element || !observer) return;
    observer.observe(element);
    return () => {
      observer.unobserve(element);
      element.removeAttribute(OFFSCREEN_ATTRIBUTE);
    };
  }, [glyph]);
  const signal = (
    <span
      ref={root}
      aria-hidden={label ? undefined : "true"}
      role={label ? "status" : undefined}
      data-size={size}
      data-working-variant={variant === "dot" ? "dot" : undefined}
      className={[
        styles.indicator,
        variant === "dot" ? "working-dot" : "",
        !children ? className : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {label ? <span className="sr-only">{label}</span> : null}
      {variant === "bars" ? (
        <span className={styles.grid} aria-hidden={label ? "true" : undefined}>
          {BARS.map((x) => (
            <span key={x} className={styles.bar} style={{ left: `${((x - 1.3) / 24) * 100}%` }} />
          ))}
        </span>
      ) : null}
    </span>
  );
  if (children === undefined) return signal;
  return (
    <span className={[styles.labeled, className].filter(Boolean).join(" ")}>
      {glyph ? signal : null}
      <Text size="inherit" tone="secondary" {...text} truncate={truncate}>
        {children}
      </Text>
    </span>
  );
}
