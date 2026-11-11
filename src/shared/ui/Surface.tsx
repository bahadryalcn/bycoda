import type { ComponentPropsWithoutRef, Ref } from "react";
import styles from "./Surface.module.css";

export type SurfaceVariant = "card" | "plain" | "raised" | "outline" | "inset" | "quiet";
export type SurfacePadding = "none" | "sm" | "md" | "lg";

export type SurfaceProps = ComponentPropsWithoutRef<"div"> & {
  ref?: Ref<HTMLElement>;
  /**
   * - `card`: the grouped card (`--ui-card-surface` fill, `--ui-card-border` frame); the same role
   *   as a settings group, so cards look alike on every screen and follow Surface contrast.
   * - `plain`: `--ui-surface` fill, the standard panel/card surface.
   * - `raised`: `--ui-surface-raised` with a `--ui-pane-border` frame (paper white in light themes).
   * - `outline`: no fill, a `--ui-pane-border` frame.
   * - `inset`: `--ui-surface-muted`, a recessed well.
   * - `quiet`: `--ui-surface-quiet` (one near-canvas step, the composer's tone) with a frame;
   *   cards inside the chat transcript, so they don't glare on a pure black/white canvas.
   */
  variant?: SurfaceVariant;
  /** Inner spacing: none, sm 8px, md 12px (default), lg 16px. */
  padding?: SurfacePadding;
  /** Element to render. Default `div`. */
  as?: "div" | "section" | "article" | "aside" | "figure" | "fieldset" | "ul" | "ol" | "li";
};

/**
 * Static container with the shared card radius (`--ui-radius-card`). Not interactive: rows
 * and cards that act use Button/ActionHost.
 *
 * Nesting: a Surface inside a Surface keeps its fill and padding but drops its frame, so
 * there is never a card inside a card. Separate nested groups with spacing or `Divider`.
 *
 * @group layout
 * @use The one static card or panel container: fill, frame, radius and padding from tokens.
 * @avoid Card in a card (nested frames drop; use spacing or Divider). Collapsible card: Disclosure variant="card". Clickable card or row: Button.
 * @example
 * <Surface variant="outline" padding="md" as="section" aria-labelledby={titleId}>
 *   <SectionLabel labelId={titleId}>{t("Memory")}</SectionLabel>
 *   <Meter label={t("Computer memory")} value={used} warning={75} danger={90} />
 * </Surface>
 */
export function Surface({
  variant = "plain",
  padding = "md",
  as = "div",
  className,
  ref,
  ...props
}: SurfaceProps) {
  // One element type for JSX; every allowed tag accepts these global attributes.
  const Root = as as "div";
  return (
    <Root
      {...props}
      ref={ref as Ref<HTMLDivElement>}
      data-variant={variant}
      data-padding={padding}
      className={[styles.surface, className].filter(Boolean).join(" ")}
    />
  );
}
