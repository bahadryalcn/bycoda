import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { useDelayedVisible } from "../hooks/useDelayedVisible";
import { useT } from "../i18n";
import { Spinner } from "./Spinner";
import { optionalTextAttributes, type TextSize, type TextTone, type TextRoles } from "./Text";
import styles from "./LoadingText.module.css";

export type LoadingTextProps = Omit<ComponentPropsWithoutRef<"div">, "children" | "role"> & {
  /** Use span inside prose; the same pending glyph and text remain phrasing content. */
  as?: "div" | "span";
  /** The status line. Defaults to "Loading…"; name what loads when it helps ("Loading branches…"). */
  children?: ReactNode;
  /** Optional explanation below the status, announced in the same live region. */
  description?: ReactNode;
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
  /** Text roles; unset preserves existing styling. */
  size?: TextSize;
  tone?: TextTone;
  weight?: TextRoles["weight"];
  /** Line height role; `inherit` keeps the surrounding line height. */
  leading?: TextRoles["leading"];
};

/**
 * Spinner plus muted caption text: the one "Loading…" line, announced politely (`role="status"`).
 * Hidden for the first moments of a wait (and shown for a minimum time via `useDelayedVisible` when callers need it), so fast loads never flash.
 * `layout="fill"` centres it in the region it replaces.
 * @group feedback
 * @use Inline text loading in a list, popover or form. One standard spinner and caption; layout changes placement only.
 * @avoid Short action: the control's own pending state. Known final layout: Skeleton. Lazy editor/media region: SurfaceLoading. Bare glyph: Spinner. Agent run: WorkingIndicator.
 */
export function LoadingText({
  as: Component = "div",
  children,
  description,
  layout = "inline",
  delay,
  className,
  style,
  size,
  tone,
  weight,
  leading,
  ...props
}: LoadingTextProps) {
  const t = useT();
  const waiting = useDelayedVisible(true, delay === false ? { delay: 0 } : undefined);
  const held = !waiting;
  if (held && layout === "inline") return null;
  return (
    <Component
      {...props}
      role={held ? undefined : "status"}
      aria-hidden={held || undefined}
      data-loading-layout={layout}
      style={style}
      {...optionalTextAttributes(
        { size: size ?? (weight ? "inherit" : undefined), tone, weight, leading },
        [
          `${Component === "span" ? "inline-flex" : "flex"} min-w-0 items-center gap-1.5 text-ui-caption text-(--ui-text-secondary)`,
          layout === "fill" ? "h-full min-h-0 justify-center p-3" : "",
          held ? styles.held : "",
          className,
        ]
          .filter(Boolean)
          .join(" "),
      )}
    >
      <Spinner size="xs" />
      <span className={description ? "min-w-0" : "min-w-0 truncate"}>
        {children ?? t("Loading…")}
        {description ? <span className="block">{description}</span> : null}
      </span>
    </Component>
  );
}
