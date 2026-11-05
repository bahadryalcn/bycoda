import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { useT } from "../i18n";
import { Spinner } from "./Spinner";
import styles from "./LoadingText.module.css";

export type LoadingTextProps = Omit<ComponentPropsWithoutRef<"div">, "children" | "role"> & {
  /** The status line. Defaults to "Loading…"; name what loads when it helps ("Loading branches…"). */
  children?: ReactNode;
  /**
   * `inline` (default): a compact start-aligned row inside a list, form or popover.
   * `fill`: centres the line in the region it replaces, for Suspense fallbacks and pane bodies.
   */
  layout?: "inline" | "fill";
  /**
   * Hold the line back briefly so work that finishes at once never flashes a loader.
   * Defaults on for `fill` (Suspense fallbacks), off for `inline`.
   */
  delay?: boolean;
  /** Text-only status for surfaces whose existing layout owns its presentation. */
  presentation?: "standard" | "text";
};

/**
 * Spinner plus muted caption text: the one "Loading…" line. Announced politely
 * (`role="status"`). Use the initiating control's own pending state for short operations,
 * Skeleton when the final layout is known, and SurfaceLoading for a lazily loaded editor
 * or media region.
 */
export function LoadingText({
  children,
  layout = "inline",
  delay,
  presentation = "standard",
  className,
  style,
  ...props
}: LoadingTextProps) {
  const t = useT();
  const held = delay ?? layout === "fill";
  if (presentation === "text") {
    return (
      <p {...props} role="status" style={style} className={className}>
        {children ?? t("Loading…")}
      </p>
    );
  }
  return (
    <div
      {...props}
      role="status"
      data-loading-layout={layout}
      style={style}
      className={[
        "flex min-w-0 items-center gap-1.5 text-ui-caption text-(--ui-text-secondary)",
        layout === "fill" ? "h-full min-h-0 justify-center p-3" : "",
        held ? styles.held : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Spinner size="xs" />
      <span className="min-w-0 truncate">{children ?? t("Loading…")}</span>
    </div>
  );
}
