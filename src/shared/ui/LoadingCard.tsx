import { useEffect, useState, type ReactNode } from "react";
import { useDelayedVisible } from "../hooks/useDelayedVisible";
import { formatDuration } from "../i18n/format";
import { elapsedSince, monotonicNow } from "../lib/time/timestamps";
import { Spinner } from "./Spinner";
import styles from "./LoadingCard.module.css";

/** A first load still running after this long is slower than usual and worth saying aloud. */
export const SLOW_LOAD_MS = 3_000;

export type LoadingCardProps = {
  /** What is loading, as a status line ("Loading Settings…"). */
  title: ReactNode;
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
};

/**
 * Centred first-load card for a page, dialog or pane: a status line with a spinner over the
 * skeleton of the content, all in one card. It keeps its box but stays invisible for the shared
 * loading delay, so a warm load never flashes it. Once the load is slow the same card adds the
 * elapsed time, an explanation and an optional way out.
 * @group feedback
 * @use Suspense fallback or first load of a page, dialog or large pane whose load can stall.
 * @avoid Inline list or popover wait: LoadingText. Short action: the control's pending state. Measurable work: Progress.
 */
export function LoadingCard({
  title,
  heading,
  children,
  slowDescription,
  slowAction,
  slowAfter = SLOW_LOAD_MS,
}: LoadingCardProps) {
  const visible = useDelayedVisible(true);
  const [startedAt] = useState(monotonicNow);
  const [elapsed, setElapsed] = useState<number | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setElapsed(elapsedSince(startedAt)), slowAfter);
    return () => window.clearTimeout(timer);
  }, [slowAfter, startedAt]);
  const slow = elapsed !== null;
  useEffect(() => {
    if (!slow) return;
    const timer = window.setInterval(() => setElapsed(elapsedSince(startedAt)), 1_000);
    return () => window.clearInterval(timer);
  }, [slow, startedAt]);
  return (
    <div className={styles.layer} data-loading-card data-held={visible ? undefined : "true"}>
      <section className={styles.card} aria-busy="true" data-slow={slow || undefined}>
        {heading ? <h1 className={styles.heading}>{heading}</h1> : null}
        <div className={styles.status} role={visible ? "status" : undefined}>
          <Spinner size="sm" className={styles.spinner} />
          <p className={styles.title}>{title}</p>
          {/* The ticking time is visual only; the status announces its text once. */}
          {slow ? (
            <span className={styles.elapsed} aria-hidden="true">
              {formatDuration(Math.max(elapsed, slowAfter))}
            </span>
          ) : null}
          {slow && slowDescription ? <p className={styles.description}>{slowDescription}</p> : null}
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
