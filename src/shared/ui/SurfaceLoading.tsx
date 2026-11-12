import { useEffect, useState, type ReactNode, type ComponentPropsWithoutRef } from "react";
import { useDelayedVisible } from "../hooks/useDelayedVisible";
import { useFormat, useT } from "../i18n";
import { elapsedSince, monotonicNow } from "../lib/time/timestamps";
import { LoadingText } from "./LoadingText";
import styles from "./SurfaceLoading.module.css";

/** A first load still running after this long is slower than usual and worth saying aloud. */
export const SLOW_LOAD_MS = 3_000;

export type SurfaceLoadingProps = Omit<ComponentPropsWithoutRef<"div">, "title" | "children"> & {
  /** What is loading, as a status line ("Loading Settings…"). */
  title?: ReactNode;
  /** Accessible loading copy for a lazy region; title takes precedence. */
  label?: string;
  /** Optional heading above the status line, such as the known page or section name. */
  heading?: ReactNode;
  /** Placeholder shapes shaped like the content (SkeletonBar pieces or Skeleton). Decorative. */
  children?: ReactNode;
  /** Shown inside the card once the load is slow: why it waits and what the user can do. */
  slowDescription?: ReactNode;
  /** Shown inside the card once the load is slow, such as a "Back to workspace" Button. */
  slowAction?: ReactNode;
  /** When the load counts as slow. Default `SLOW_LOAD_MS`. */
  slowAfter?: number;
  /** Disable the delay for a load started by the user's action. */
  delay?: boolean;
};

/**
 * One first-load surface for a page, dialog, editor or media pane: the standard loading line
 * above optional content-shaped placeholders. It keeps its box but stays invisible for the shared
 * loading delay, so a warm load never flashes it. Once the load is slow the same card adds the
 * elapsed time, an explanation and an optional way out.
 * @group feedback
 * @use Surface/page loading, including lazy editors and media. Optional heading, skeleton and slow-load recovery stay inside this surface.
 * @avoid Inline text loading: LoadingText. Control busy: Spinner or Button loading. Known-layout placeholder: Skeleton. Agent working: WorkingIndicator.
 */
export function SurfaceLoading({
  title,
  label,
  heading,
  children,
  slowDescription,
  slowAction,
  slowAfter = SLOW_LOAD_MS,
  delay = true,
  className,
  ...props
}: SurfaceLoadingProps) {
  const t = useT();
  const { formatDuration } = useFormat();
  const visible = useDelayedVisible(true, delay ? undefined : { delay: 0 });
  const [startedAt] = useState(monotonicNow);
  const [elapsed, setElapsed] = useState<number | null>(null);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- owns the slow-load threshold timer while this loading surface is mounted
  useEffect(() => {
    const timer = window.setTimeout(() => setElapsed(elapsedSince(startedAt)), slowAfter);
    return () => window.clearTimeout(timer);
  }, [slowAfter, startedAt]);
  const slow = elapsed !== null;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- keeps the elapsed label in step with a one-second timer after the slow-load threshold
  useEffect(() => {
    if (!slow) return;
    const timer = window.setInterval(() => setElapsed(elapsedSince(startedAt)), 1_000);
    return () => window.clearInterval(timer);
  }, [slow, startedAt]);
  return (
    <div
      {...props}
      className={[styles.layer, className].filter(Boolean).join(" ")}
      data-loading-card
      data-held={visible ? undefined : "true"}
    >
      <section
        className={styles.card}
        aria-busy="true"
        data-slow={slow || undefined}
        data-content={Boolean(heading || children || slowAction) || undefined}
      >
        {heading ? <h1 className={styles.heading}>{heading}</h1> : null}
        <div className={styles.status}>
          {visible ? (
            <LoadingText delay={false} description={slow ? slowDescription : undefined}>
              {title ?? label ?? t("Loading…")}
            </LoadingText>
          ) : null}
          {/* The ticking time is visual only; the status announces its text once. */}
          {slow ? (
            <span className={styles.elapsed} aria-hidden="true">
              {formatDuration(Math.max(elapsed, slowAfter))}
            </span>
          ) : null}
        </div>
        {children ? (
          <div className={styles.body} aria-hidden="true">
            {children}
          </div>
        ) : null}
        {slow && slowAction ? <div className={styles.actions}>{slowAction}</div> : null}
      </section>
    </div>
  );
}
