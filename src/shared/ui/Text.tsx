import type { ComponentPropsWithRef, CSSProperties, Ref } from "react";
import styles from "./Text.module.css";

/** Body type sizes; `inherit` keeps the size of the surrounding text. */
export type TextSize =
  | "caption"
  | "micro"
  | "secondary"
  | "body"
  | "title"
  | "heading"
  | "glyph"
  | "inherit";

/** Ink roles; `inherit` keeps the colour of the surrounding text. */
export type TextTone =
  | "secondary"
  | "muted"
  | "primary"
  | "disabled"
  | "neutral"
  | "accent"
  | "feature"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "added"
  | "removed"
  | "on-solid"
  | "accent-on-solid"
  | "background-base"
  | "inherit";

/** Line heights; `inherit` keeps the line height of the surrounding text. */
export type TextLeading = "none" | "tight" | "snug" | "normal" | "relaxed" | "inherit";

/** Elements Text can be; all take the same attributes. */
export type TextElement =
  | "span"
  | "p"
  | "div"
  | "li"
  | "label"
  | "strong"
  | "em"
  | "figcaption"
  | "section"
  | "ul"
  | "ol"
  | "header"
  | "footer"
  | "nav"
  | "aside"
  | "main"
  | "article"
  | "form"
  | "blockquote"
  | "small"
  | "b"
  | "mark"
  | "kbd";

/** Letter spacing: `normal` resets, `tight` -0.025em, `wide` 0.025em, `wider` 0.08em. */
export type TextTracking = "normal" | "tight" | "wide" | "wider";

/** The type roles shared by Text and by components that render text themselves. */
export type TextRoles = {
  size?: TextSize;
  tone?: TextTone;
  weight?: "regular" | "medium";
  leading?: TextLeading;
  truncate?: boolean;
  /** Keep words intact; `anywhere` also breaks long identifiers when needed. */
  wrap?: "normal" | "anywhere";
  tracking?: TextTracking;
  /** Underline only when pointer hovers this text. */
  hoverUnderline?: boolean;
};

/**
 * Ref of the rendered element, whatever `as` is: a ref object of any element type, or a callback
 * (typed bivariantly, so a callback of any element type fits).
 */
export type TextRef =
  | { bivarianceHack(element: HTMLSpanElement | null): void }["bivarianceHack"]
  | { current: unknown }
  | null;

export type TextProps = Omit<ComponentPropsWithRef<"span">, "ref"> & {
  /** Ref of the rendered element, whatever `as` is. */
  ref?: TextRef;
  /** The control a `label` names. */
  htmlFor?: string;
  /**
   * Element: `span` (default, inline), `p` for a paragraph, `div` for a block, `li` for a list
   * item, `label`, `strong`, `em`, `figcaption`, or a semantic container (`section`, `ul`, `ol`,
   * `header`, `footer`, `nav`, `aside`, `main`, `article`, `form`), a `blockquote`, `small`, `b` (bold
   * emphasis of a figure inside a sentence), `mark` (a highlighted match), or `kbd` (key text).
   * Never a heading.
   */
  as?: TextElement;
  /** Maximum visible lines; unset removes the clamp. Full text remains in the DOM. */
  lines?: number;
  /**
   * - `caption`: 12px. Default.
   * - `micro`: 11px, for dense rows, meta lines and badges of text.
   * - `secondary`: 13px.
   * - `body`: 14px, for prose.
   * - `title`: 16px and `heading`: 20px, for a value that is displayed large (a figure, a
   *   count, initials) and is not the title of anything; a title is Heading.
   * - `inherit`: the surrounding size; only tone, weight or leading are set.
   */
  size?: TextSize;
  /**
   * `on-solid` pairs with generic solid fills; `accent-on-solid` pairs with accent solid fills.
   * `secondary` (default) and `muted` for supporting text, `primary` for the content ink,
   * `disabled` for unavailable text, a status tone for text that reports one, `added` and `removed` for the
   * diff inks (a change letter, a changed line), `inherit` for the surrounding colour.
   */
  tone?: TextTone;
  /** Weight; unset keeps the surrounding weight. */
  weight?: "regular" | "medium";
  /**
   * Line height; unset follows the size. `none` 1, `tight` 1.25, `snug` 1.375, `normal` 1.5,
   * `relaxed` 1.625, `inherit` the surrounding line height.
   */
  leading?: TextLeading;
  /**
   * One line; text that does not fit ends in an ellipsis. Sets `min-width: 0` so it can shrink
   * inside a flex or grid row. Needs a block box: a flex or grid item, or `as="div"` / `as="p"`.
   */
  truncate?: boolean;
  /** Wrap prose at words, with `anywhere` as an emergency break for long identifiers. */
  wrap?: "normal" | "anywhere";
  /**
   * Letter spacing; `normal` resets inherited tracking. Unset keeps the surrounding spacing. `tight` -0.025em, `wide` 0.025em,
   * `wider` 0.08em.
   */
  tracking?: TextTracking;
  /** Underline only when pointer hovers this text. */
  hoverUnderline?: boolean;
};

/**
 * Body text in one of the shared type roles: size, ink, weight and line height come from props,
 * never from a local class. The defaults are the workbench's most common pair, caption size in
 * the secondary ink. `className` is for placement (margin, grid, width).
 *
 * Migrating feature type to Text: a font size becomes the role equal to the old value or the
 * nearest smaller one; a line height becomes the nearest role, so 1.6 is `leading="relaxed"`
 * (1.625) and 1.55 is `normal` (1.5). Text that only set a colour keeps its size with `size="inherit"`; text that only set a
 * size keeps its colour with `tone="inherit"`; text that set a size but took its line height from
 * the container keeps it with `leading="inherit"`.
 * @group text
 * @use Supporting text, meta lines, descriptions, values and status text in a feature.
 * @avoid A title of a page, section, card or row: Heading. A caption over a group or list: SectionLabel. Text clamped to several lines: ClampText. A path or id cut in the middle: MiddleTruncate. A field label, help or error: Field. Inline code: Code. Command or log output: OutputBlock. Added and removed line counts: DiffStat.
 * @example
 * <Text>{t("Updated 2 minutes ago")}</Text>
 * <Text as="p" size="body" tone="primary" leading="relaxed">{summary}</Text>
 * <Text size="inherit" tone="danger" weight="medium">{t("Failed")}</Text>
 * <Text truncate className="flex-1">{session.title}</Text>
 */
export function Text({
  as = "span",
  lines,
  style,
  size = "caption",
  tone = "secondary",
  weight,
  leading,
  truncate = false,
  wrap,
  tracking,
  hoverUnderline,
  className,
  ref,
  ...props
}: TextProps) {
  // One prop type for every tag: they take the same attributes.
  const Tag = as as "span";
  return (
    <Tag
      {...props}
      data-lines={lines || undefined}
      style={lines ? ({ ...style, "--clamp-lines": lines } as CSSProperties) : style}
      ref={ref as Ref<HTMLSpanElement>}
      {...textAttributes(
        { size, tone, weight, leading, truncate, wrap, tracking, hoverUnderline },
        className,
      )}
    />
  );
}

/**
 * `textAttributes` only when a role is set, so a component whose caller passes no role renders
 * exactly the attributes it rendered before.
 */
export function optionalTextAttributes(roles: TextRoles, className?: string) {
  return roles.size ||
    roles.tone ||
    roles.weight ||
    roles.leading ||
    roles.truncate ||
    roles.wrap ||
    roles.tracking ||
    roles.hoverUnderline
    ? textAttributes(roles, className)
    : { className };
}

/**
 * The attributes that give an element the shared type roles. For shared components that render
 * their own text element (a timestamp, a truncated path, a live message) and take `size` and
 * `tone` props; feature code uses Text. Unset roles inherit, so a component that passes nothing
 * looks as it did.
 */
export function textAttributes(
  {
    size = "inherit",
    tone = "inherit",
    weight,
    leading = size === "inherit" ? "inherit" : undefined,
    truncate,
    wrap,
    tracking,
    hoverUnderline,
  }: TextRoles,
  className?: string,
) {
  return {
    "data-tracking": tracking,
    "data-hover-underline": hoverUnderline || undefined,
    "data-size": size,
    "data-tone": tone,
    "data-weight": weight,
    "data-leading": leading,
    "data-truncate": truncate || undefined,
    "data-wrap": wrap,
    className: [styles.text, className].filter(Boolean).join(" "),
  };
}
