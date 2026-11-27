import type { ComponentPropsWithoutRef, Ref } from "react";
import styles from "./Surface.module.css";

export type SurfaceVariant =
  /** Page role: no fill or frame; the content sits on its host ground. */
  | "page"
  | "transparency-grid"
  | "card"
  | "inset"
  | "canvas"
  /** Full-window overlays that need a solid palette ground even over native glass. */
  | "opaque-canvas"
  | "workspace-panel"
  | "canvas-chat"
  | "reading-base"
  | "selected"
  | "danger"
  | "floating"
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
  /** User identity tint; keeps normal text contrast. Supply --surface-user-color. */
  | "user-color-tint"
  | "neutral-boundary"
  | "drop-line"
  | "drop-blocked"
  | "diff-add"
  | "diff-delete";
/**
 * The four container roles of the component system. Frames are none/pane/card; radii control 8,
 * row 6, popup 12.
 * - `page`: canvas, no frame.
 * - `card`: card border, radius control.
 * - `inset`: muted ground, radius row (code, output, wells).
 * - `floating`: popup radius and floating elevation.
 * A Surface inside a Surface of the same role paints no second fill or frame.
 */
export type SurfaceRole = "page" | "card" | "inset" | "floating";

/** Role of each container and shell ground; tone, identity and diff grounds have none. */
const VARIANT_ROLE: Partial<Record<SurfaceVariant, SurfaceRole>> = {
  page: "page",
  canvas: "page",
  "opaque-canvas": "page",
  "canvas-chat": "page",
  "reading-base": "page",
  "workspace-panel": "page",
  card: "card",
  inset: "inset",
  floating: "floating",
};

/** The role a variant resolves to; unset for tone, identity and diff grounds. */
export function surfaceRole(variant: SurfaceVariant | undefined): SurfaceRole | undefined {
  return variant ? VARIANT_ROLE[variant] : undefined;
}

export type SurfacePadding = "none" | "sm" | "md" | "lg";

export type SurfaceAppearance = {
  /** Search reveal on a settings row or existing group content. */
  reveal?: "row" | "group";
  /** Inset document selection outline, driven by the existing aria-selected state. */
  selectionRing?: "document";
  /** Visible inset outline for keyboard-focusable scroll regions. */
  focusRing?: "inset" | "preview-inset" | "outer";
  /** Settings rows use their group hairlines and corners. */
  layout?: "settings-group" | "settings-group-flat" | "settings-rows" | "settings-account-list";
  /** One hairline after each direct child except the last; no outer frame or layout.
   * `pane` uses the pane border, `card` the card border.
   * Replaces vertical divide-y lists. Horizontal splits keep Divider. */
  dividers?: "pane" | "card";
  /** A settings hairline before this box only when its previous sibling also opts in. */
  separator?: "block" | "pane-block";
  /** Static ground only; workspace variants inherit artwork and transparency preferences. */
  variant?: SurfaceVariant;
  /** Opt-in frame: none removes border space; other roles retain a 1px boundary.
   * Hairlines are two roles: `pane` for edges between panes, rows and lists, `card` around a whole card.
   * `transparent` reserves border space without painting a boundary; `danger` frames an error summary, `warning` a caution or limit summary (pair with `tone="warning"` for the fill, which tone alone does not frame).
   * `focus` marks a detaching surface; `muted` frames a hollow progress marker. */
  frame?:
    | "none"
    | "pane"
    | "card"
    | "base-cutout"
    | "content-strong"
    | "neutral-marker"
    | "transparent"
    | "danger"
    | "warning"
    | "accent"
    | "focus"
    | "muted";
  /** Framed edge(s), default all. Logical edges follow writing direction; top/bottom/left/right preserve physical edges.
   * For `start`, set `--surface-frame-inline-start-visible: 0` to keep only the block-start edge.
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
  /** `glass` with the `floating` role: a panel docked over a scrolling transcript (the composer's
   *  activity dock and queue card) is a translucent veil over a blur instead of the opaque popup
   *  fill. While its pane streams, with blur off, forced colors or reduced transparency it falls
   *  back to the opaque composer surface. */
  material?: "glass";
  /** One-pixel inset ring (`box-shadow: inset`) in a semantic edge colour: `stroke` the neutral
   *  divider colour, `accent` the interaction ink, `tone-accent`/`tone-neutral` their tone borders. It is a
   *  box-shadow, so it adds no border width; it replaces `ring-1 ring-inset ring-*` classes.
   *  `pane-outer` draws outside instead; `base-outer` is a 2px base cutout around an account dot. */
  ring?:
    | "pane"
    | "accent"
    | "tone-accent"
    | "tone-neutral"
    | "pane-outer"
    | "base-outer"
    | "panel-outer";
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
    "data-surface-role": surfaceRole(appearance.variant),
    "data-surface-frame": appearance.frame,
    "data-surface-edge": appearance.edge,
    "data-surface-border-style": appearance.borderStyle,
    "data-surface-radius": appearance.radius,
    "data-surface-tone": appearance.tone,
    "data-surface-tone-fill": appearance.toneFill,
    "data-surface-elevation": appearance.elevation,
    "data-surface-material": appearance.material,
    "data-surface-ring": appearance.ring,
    "data-surface-separator": appearance.separator,
    className: [styles.appearance, className].filter(Boolean).join(" "),
  };
}

export type SurfaceProps = ComponentPropsWithoutRef<"div"> & {
  ref?: Ref<HTMLElement>;
  /**
   * Container role (default `page`):
   * - `page`: no fill or frame; content sits on its host ground.
   * - `card`: `--ui-card-surface` fill and `--ui-card-border` frame, the one card on every screen.
   * - `inset`: `--ui-surface-muted`, a recessed well (code, output, metadata).
   * - `floating`: `--ui-surface-floating`, popups and docks.
   * Shell pane roots only: `canvas`, `workspace-panel`, `canvas-chat`, `reading-base` (follow
   * workspace artwork and transparency). Domain grounds: selected, danger, diff, attachment,
   * identity and marker variants.
   */
  variant?: SurfaceVariant;
  /** Inner spacing: none, sm 8px, md 12px (default), lg 16px. */
  padding?: SurfacePadding;
  /** Element to render. Default `div`. */
  as?: "div" | "section" | "article" | "aside" | "figure" | "fieldset" | "ul" | "ol" | "li";
} & Omit<SurfaceAppearance, "variant">;

/**
 * Static container in one of four roles (page, card, inset, floating; see `SurfaceRole`);
 * express the rest with `tone`, `frame` (none, pane, card) and `radius` (control, row, popup).
 *
 * Static container with the shared card radius (`--ui-radius-card`). Not interactive: rows
 * and cards that act use Button/ActionHost.
 *
 * Nesting: a Surface inside a Surface of the same role paints no second fill or frame, so
 * there is never a card inside a card. Separate nested groups with spacing or `Divider`.
 * Shell grounds: canvas, workspace-panel, canvas-chat, reading-base use the workspace theme
 * roles. selected is a static highlight, never an action. danger tints error-bearing panels.
 * Explicit frame/radius overrides are opt-in; omitted props retain the established render.
 *
 * @group layout
 * @use The one static card or panel container: fill, frame, radius and padding from tokens.
 * @avoid Card in a card (nested frames drop; use spacing or Divider). Collapsible card: Disclosure variant="card". Clickable card or row: Button.
 * @example
 * <Surface variant="card" padding="md" as="section" aria-labelledby={titleId}>
 *   <SectionLabel labelId={titleId}>{t("Memory")}</SectionLabel>
 *   <Meter label={t("Computer memory")} value={used} warning={75} danger={90} />
 * </Surface>
 */
export function Surface({
  variant = "page",
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
  material,
  ring,
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
      data-surface-role={surfaceRole(variant)}
      data-padding={padding}
      data-surface-frame={frame}
      data-surface-edge={edge}
      data-surface-border-style={borderStyle}
      data-surface-radius={radius}
      data-surface-tone={tone}
      data-surface-tone-fill={toneFill}
      data-surface-elevation={elevation}
      data-surface-material={material}
      data-surface-ring={ring}
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
