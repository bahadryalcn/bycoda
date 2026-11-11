import type { CSSProperties } from "react";
import { useDelayedVisible } from "../hooks/useDelayedVisible";
import { useT } from "../i18n";
import {
  Skeleton as ArcSkeleton,
  type SkeletonProps as ArcSkeletonProps,
} from "./arc/skeleton/skeleton";
import styles from "./Skeleton.module.css";

export type SkeletonProps = ArcSkeletonProps & {
  /** `span` renders one inline bar that is valid inside a paragraph (Markdown or media
   *  placeholders). `lines`, `avatar` and `children` are ignored in that form. Default `div`. */
  as?: "div" | "span";
  /** Shorthand for `as="span"`. */
  inline?: boolean;
  /** Bar width of the inline form (any CSS length). Default `6em`. */
  width?: string;
  /**
   * Keep the placeholder invisible and unannounced for the first moments (`LOADING_DELAY_MS`) so a
   * fast load never flashes it; it holds its height meanwhile. Default on; ignored when `children`
   * swap in. Pass `false` only where the wait directly follows a user action.
   */
  delay?: boolean;
};

/**
 * Placeholder bars (or lines and avatar) shaped like the content that is loading, announced as a busy status.
 * `as="span"` / `inline` renders one bar valid inside a paragraph; `loading` + children swap in the real content.
 * Hidden for the first moments of a wait, keeping its height, so fast loads never flash it.
 * @group feedback
 * @use First load where the final layout is known, so nothing jumps when data arrives.
 * @avoid Unknown layout or one-line status: LoadingText. Lazy editor or media region: SurfaceLoading. Pending button: Spinner on the button.
 * @arc skeleton
 */
export function Skeleton({
  label,
  className,
  as = "div",
  inline = false,
  width,
  lines,
  avatar,
  children,
  loading,
  delay = true,
  "aria-hidden": ariaHidden,
}: SkeletonProps) {
  const t = useT();
  const waiting = useDelayedVisible(
    true,
    delay && children === undefined ? undefined : { delay: 0 },
  );
  const held = !waiting;
  const resolvedLabel = label ?? t("Loading…");
  if (as === "span" || inline) {
    // Inline bars sit in running text and are cheap; they follow the same delay via visibility.
    const hidden = ariaHidden === true || ariaHidden === "true";
    return (
      <span
        className={["bycoda-arc", styles.inline, held ? styles.held : "", className]
          .filter(Boolean)
          .join(" ")}
        role={hidden || held ? undefined : "status"}
        aria-label={hidden || held ? undefined : resolvedLabel}
        aria-busy={hidden ? undefined : true}
        aria-hidden={hidden || held || undefined}
        style={width ? ({ "--skeleton-inline-width": width } as CSSProperties) : undefined}
      />
    );
  }
  return (
    <ArcSkeleton
      lines={lines}
      avatar={avatar}
      loading={loading}
      aria-hidden={ariaHidden}
      label={resolvedLabel}
      className={["bycoda-arc", held ? styles.held : "", className].filter(Boolean).join(" ")}
    >
      {children}
    </ArcSkeleton>
  );
}

export type SkeletonBarProps = {
  /** Any CSS length. Default `100%`. */
  width?: string;
  /** Any CSS length. Default `0.75rem` (one caption line). */
  height?: string;
  /** `bar` (default) for text and controls, `square` for icons and avatars, `pill` for chips. */
  shape?: "bar" | "square" | "pill";
  /** Position in the layout; each shape pulses a beat after the one before it. */
  index?: number;
  className?: string;
};

/**
 * One decorative placeholder shape for a skeleton composed to mirror a specific layout (a settings
 * rail, a framed row). Hidden from assistive technology: the composing surface owns the one busy
 * status and the loading delay. Same tone and finite pulse as Skeleton.
 * @group feedback
 * @use Building blocks of a layout-shaped first-load placeholder.
 * @avoid A generic block of lines: Skeleton. Inside running text: Skeleton `inline`.
 */
export function SkeletonBar({
  width,
  height,
  shape = "bar",
  index = 0,
  className,
}: SkeletonBarProps) {
  return (
    <span
      aria-hidden="true"
      data-shape={shape}
      className={[styles.bar, className].filter(Boolean).join(" ")}
      style={
        {
          "--skeleton-bar-width": width,
          "--skeleton-bar-height": height,
          "--index": index,
        } as CSSProperties
      }
    />
  );
}
