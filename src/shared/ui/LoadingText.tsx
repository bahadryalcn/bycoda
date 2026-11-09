import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { useDelayedVisible } from "../hooks/useDelayedVisible";
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
   * Hold the line back (see `LOADING_DELAY_MS`) so work that finishes quickly never flashes a
   * loader. While waiting, `inline` renders nothing (no reserved gap that would collapse again) and
   * `fill` keeps the region's box, which the loaded content replaces anyway. Default on; pass `false` only
   * where the wait is the direct result of a user action.
   */
  delay?: boolean;
  /** Text-only status for surfaces whose existing layout owns its presentation. */
  presentation?: "standard" | "text";
};

/**
 * Spinner plus muted caption text: the one "Loading…" line, announced politely (`role="status"`).
 * Hidden for the first moments of a wait (and shown for a minimum time via `useDelayedVisible` when callers need it), so fast loads never flash.
 * `layout="fill"` centres it in the region it replaces.
 * @group feedback
 * @use A list, popover or pane body waiting for data; Suspense fallbacks (`layout="fill"`).
 * @avoid Short action: the control's own pending state. Known final layout: Skeleton. Lazy editor/media region: SurfaceLoading. Bare glyph: Spinner. Agent run: WorkingIndicator.
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
  const waiting = useDelayedVisible(true, delay === false ? { delay: 0 } : undefined);
  const held = !waiting;
  if (held && layout === "inline") return null;
  if (presentation === "text") {
    return (
      <p
        {...props}
        role={held ? undefined : "status"}
        aria-hidden={held || undefined}
        style={style}
        className={[held ? styles.held : "", className].filter(Boolean).join(" ") || undefined}
      >
        {children ?? t("Loading…")}
      </p>
    );
  }
  return (
    <div
      {...props}
      role={held ? undefined : "status"}
      aria-hidden={held || undefined}
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
