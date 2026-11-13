import type { ComponentPropsWithoutRef, Ref } from "react";
import styles from "./Surface.module.css";

export type SurfaceVariant =
  | "composer-glass"
  | "reading-panel"
  | "transparency-grid"
  | "activity-dock"
  | "neutral-metadata"
  | "fill-faint"
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
  | "fill-subtle"
  /** Static neutral-hover ground for a transcript bubble. */
  | "neutral-hover"
  /** Foreground-strength info fill for a compact activity count. */
  | "info-foreground"
  /** Attachment-kind ink mixed at 14% for a file or image tile. */
  | "attachment"
  /** Existing accent dot and low-contrast selection counter grounds. */
  | "accent-marker"
  | "selection"
  /** QR code ground contrasting with a solid surface. */
  | "on-solid"
  /** User-selected identity swatch; caller supplies --surface-user-color. */
  | "user-color"
  | "neutral-boundary"
  | "drop-line"
  | "drop-blocked"
  | "diff-add"
  | "diff-delete"
  | "adaptive-base";
export type SurfacePadding = "none" | "sm" | "md" | "lg";

export type SurfaceAppearance = {
  /** Search reveal on a settings row or existing group content. */
  reveal?: "row" | "group";
  /** Inset document selection outline, driven by the existing aria-selected state. */
  selectionRing?: "document";
  /** Visible inset outline for keyboard-focusable scroll regions. */
  focusRing?: "inset" | "preview-inset" | "outer";
  /** Mixed settings rows and disclosures use their existing group hairlines and corners. */
  layout?:
    | "settings-group"
    | "settings-group-flat"
    | "settings-advanced"
    | "settings-rows"
    | "settings-account-list";
  /** One hairline after each direct child except the last; no outer frame or layout.
   * `pane` uses the pane border; stroke and card retain their own tokens.
   * Replaces vertical divide-y lists. Horizontal splits keep Divider. */
  dividers?: "stroke" | "card" | "pane" | "neutral" | "settings-group";
  /** A settings hairline before this box only when its previous sibling also opts in. */
  separator?: "block" | "pane-block";
  /** Static ground only; workspace variants inherit artwork and transparency preferences. */
  variant?: SurfaceVariant;
  /** Opt-in frame: none removes border space; other roles retain a 1px boundary.
   * `frosted` preserves the divider role over translucent workspace artwork;
   * `transparent` reserves border space without painting a boundary; `danger` frames an error summary.
   * `focus` marks a detaching surface; `muted` frames a hollow progress marker. */
  frame?:
    | "none"
    | "pane"
    | "pane-stroke"
    | "card"
    | "stroke"
    | "neutral"
    | "neutral-metadata"
    | "base-cutout"
    | "content-strong"
    | "terminal"
    | "neutral-marker"
    | "settings"
    | "frosted"
    | "transparent"
    | "danger"
    | "accent"
    | "editor"
    | "focus"
    | "muted";
  /** Framed edge(s), default all. Logical edges follow writing direction; top/bottom/left/right preserve physical edges.
   * `responsive-start` keeps a 1px inline-start frame; the owning layout sets
   * `--surface-frame-stacked: 1` at its existing container breakpoint to move it to block-start (0 restores inline-start).
   * Set `--surface-frame-visible: 0` when the layout hides that boundary (default 1).
   * `responsive-end` similarly moves inline-end to block-end; `start` frames both logical start edges.
   * The layout controls orientation and visibility only; frame colour and thickness stay shared. */
  edge?:
    | "all"
    | "start"
    | "block-start"
    | "block-end"
    | "inline-start"
    | "responsive-start"
    | "responsive-left"
    | "responsive-end"
    | "inline-end"
    | "block"
    | "inline"
    | "top"
    | "bottom"
    | "left"
    | "right";
  /** Frame line style. Unset preserves the existing solid frame. */
  borderStyle?: "solid" | "dashed";
  /** Explicit shape: none 0, xs 2px, sm 4px, row 6px, well 16px (an icon well), circle 50% (a round well or dot);
   * `right-control` rounds physical right corners; `dock-top` rounds the upper edge of a dock;
   * control/card/panel/popup/pill use existing radius roles. Unset preserves the existing radius. */
  radius?:
    | "none"
    | "dock-top"
    | "field"
    | "xs"
    | "sm"
    | "row"
    | "well"
    | "right-control"
    | "chat-start"
    | "chat-end"
    | "chat-control-start"
    | "chat-control-end"
    | "preview"
    | "circle"
    | "control"
    | "card"
    | "panel"
    | "popup"
    | "pill";
  /** Subtle semantic fill (`--ui-tone-<tone>-subtle`) for a static note, badge-like well or status
   *  panel. Background only: the frame stays as the other props set it. Use the same tone the
   *  caller already derives for its text; a state fill passes `undefined` when the state is off. */
  tone?: SurfaceTone;
  /** Strength of `tone`: `subtle` (default) the tinted ground, `solid` the full tone for a dot,
   *  avatar or marker. Unset with a tone keeps the subtle fill. */
  toneFill?: "subtle" | "solid";
  /** Floating shadow (`--ui-elevation-floating`) for a static panel that sits above content and
   *  is not a popup owner. Popups, menus and tooltips keep their Popover or Modal owner. */
  /** `sticky-mask` covers the 4px base-canvas seam above a sticky settings section. */
  elevation?: "floating" | "sticky-mask";
  /** One-pixel inset ring (`box-shadow: inset`) in a semantic edge colour: `stroke` the neutral
   *  divider colour, `accent` the interaction ink, `tone-accent`/`tone-neutral` their tone borders. It is a
   *  box-shadow, so it adds no border width; it replaces `ring-1 ring-inset ring-*` classes.
   *  `pane-outer` draws outside instead; `base-outer` is a 2px base cutout around an account dot. */
  ring?:
    | "stroke"
    | "accent"
    | "tone-accent"
    | "tone-neutral"
    | "pane-outer"
    | "base-outer"
    | "panel-outer";
  /** A 2px inline-start accent bar for a quoted note, citation or status row. `pane` is the pane
   *  frame colour, `neutral` the neutral tone border, `accent` the interaction ink, `info` the info
   *  tone foreground, `user-accent` the configured accent and `success` the success tone border.
   *  It draws only that one edge. */
  bar?:
    | "pane"
    | "neutral"
    | "accent"
    | "user-accent"
    | "info"
    | "success"
    | "diagnostic-danger"
    | "diagnostic-empty";
};

/** The semantic tones with a subtle fill token (`--ui-tone-<tone>-subtle`). */
export type SurfaceTone = "neutral" | "accent" | "info" | "success" | "warning" | "danger";

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
    "data-surface-dividers": appearance.dividers,
    "data-surface-focus-ring": appearance.focusRing,
    "data-surface-selection-ring": appearance.selectionRing,
    "data-surface-layout": appearance.layout,
    "data-surface-reveal": appearance.reveal,
    "data-surface-variant": appearance.variant,
    "data-surface-frame": appearance.frame,
    "data-surface-edge": appearance.edge,
    "data-surface-border-style": appearance.borderStyle,
    "data-surface-radius": appearance.radius,
    "data-surface-tone": appearance.tone,
    "data-surface-tone-fill": appearance.toneFill,
    "data-surface-elevation": appearance.elevation,
    "data-surface-ring": appearance.ring,
    "data-surface-bar": appearance.bar,
    "data-surface-separator": appearance.separator,
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
  tone,
  toneFill,
  elevation,
  ring,
  bar,
  separator,
  dividers,
  focusRing,
  selectionRing,
  layout,
  reveal,
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
      data-surface-tone={tone}
      data-surface-tone-fill={toneFill}
      data-surface-elevation={elevation}
      data-surface-ring={ring}
      data-surface-bar={bar}
      data-surface-separator={separator}
      data-surface-dividers={dividers}
      data-surface-focus-ring={focusRing}
      data-surface-selection-ring={selectionRing}
      data-surface-layout={layout}
      data-surface-reveal={reveal}
      className={[styles.surface, className].filter(Boolean).join(" ")}
    />
  );
}
