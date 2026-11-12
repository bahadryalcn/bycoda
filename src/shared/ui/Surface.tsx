import type { ComponentPropsWithoutRef, Ref } from "react";
import styles from "./Surface.module.css";

export type SurfaceVariant =
  | "card"
  | "plain"
  | "raised"
  | "outline"
  | "inset"
  | "quiet"
  | "canvas"
  | "workspace-panel"
  | "canvas-chat"
  | "canvas-surface"
  | "reading-base"
  | "navigation-quiet"
  | "selected"
  | "transparent"
  | "danger"
  | "danger-floating"
  | "translucent"
  | "effort"
  | "effort-ultra"
  | "base"
  | "panel"
  | "floating"
  | "fill-subtle";
export type SurfacePadding = "none" | "sm" | "md" | "lg";

export type SurfaceAppearance = {
  /** Static ground only; workspace variants inherit artwork and transparency preferences. */
  variant?: SurfaceVariant;
  /** Opt-in frame: none removes border space; pane/card/stroke/neutral/settings retain a 1px boundary. */
  frame?: "none" | "pane" | "card" | "stroke" | "neutral" | "settings";
  /** Framed edge(s), default all. Logical edges follow writing direction; top/bottom/left/right preserve physical edges. */
  edge?:
    | "all"
    | "block-start"
    | "block-end"
    | "inline-start"
    | "inline-end"
    | "block"
    | "inline"
    | "top"
    | "bottom"
    | "left"
    | "right";
  /** Frame line style. Unset preserves the existing solid frame. */
  borderStyle?: "solid" | "dashed";
  /** Explicit shape: none 0, xs 2px, sm 4px, row 6px; control/card/panel/popup/pill use existing radius roles. Unset preserves the existing radius. */
  radius?: "none" | "xs" | "sm" | "row" | "control" | "card" | "panel" | "popup" | "pill";
};

/**
 * Static box presentation on an existing semantic/text/scroll element, without a wrapper,
 * layout, padding or implicit frame. Only supplied roles paint; keep the element's classes.
 * @group layout
 * @use Preserve an existing static box whose element is owned by Text or ScrollArea.
 * @avoid Actions: Button/ActionHost. Labels: Badge. Separators: Divider. Overlays keep their owner.
 * @example
 * <Text {...surfaceAttributes({ variant: "canvas" }, "flex flex-1")} as="main" />
 */
export function surfaceAttributes(appearance: SurfaceAppearance, className?: string) {
  return {
    "data-surface-variant": appearance.variant,
    "data-surface-frame": appearance.frame,
    "data-surface-edge": appearance.edge,
    "data-surface-border-style": appearance.borderStyle,
    "data-surface-radius": appearance.radius,
    className: [styles.appearance, className].filter(Boolean).join(" "),
  };
}

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
} & Omit<SurfaceAppearance, "variant">;

/**
 * Static container with the shared card radius (`--ui-radius-card`). Not interactive: rows
 * and cards that act use Button/ActionHost.
 *
 * Nesting: a Surface inside a Surface keeps its fill and padding but drops its frame, so
 * there is never a card inside a card. Separate nested groups with spacing or `Divider`.
 * Workspace grounds: canvas, workspace-panel, canvas-chat, canvas-surface, reading-base,
 * navigation-quiet use their existing theme roles. selected is a static highlight, never an action.
 * danger/danger-floating tint error-bearing reading/floating panels; translucent is native popup glass.
 * Explicit frame/radius overrides are opt-in; omitted props retain the established render.
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
  frame,
  edge,
  borderStyle,
  radius,
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
      data-surface-frame={frame}
      data-surface-edge={edge}
      data-surface-border-style={borderStyle}
      data-surface-radius={radius}
      className={[styles.surface, className].filter(Boolean).join(" ")}
    />
  );
}
