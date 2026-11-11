import type { ComponentPropsWithRef } from "react";
import styles from "./Text.module.css";

/** Body type sizes; `inherit` keeps the size of the surrounding text. */
export type TextSize = "caption" | "micro" | "secondary" | "body" | "inherit";

/** Ink roles; `inherit` keeps the colour of the surrounding text. */
export type TextTone =
  | "secondary"
  | "muted"
  | "primary"
  | "disabled"
  | "neutral"
  | "accent"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "inherit";

export type TextProps = ComponentPropsWithRef<"span"> & {
  /** Element: `span` (default, inline), `p` for a paragraph, `div` for a block. Never a heading. */
  as?: "span" | "p" | "div";
  /**
   * - `caption`: 12px. Default.
   * - `micro`: 11px, for dense rows, meta lines and badges of text.
   * - `secondary`: 13px.
   * - `body`: 14px, for prose.
   * - `inherit`: the surrounding size; only tone, weight or leading are set.
   */
  size?: TextSize;
  /**
   * `secondary` (default) and `muted` for supporting text, `primary` for the content ink,
   * `disabled` for unavailable text, a status tone for text that reports one, `inherit` for
   * the surrounding colour.
   */
  tone?: TextTone;
  /** Weight; unset keeps the surrounding weight. */
  weight?: "regular" | "medium";
  /**
   * Line height; unset follows the size. `none` 1, `tight` 1.25, `snug` 1.375, `normal` 1.5,
   * `relaxed` 1.625.
   */
  leading?: "none" | "tight" | "snug" | "normal" | "relaxed";
  /**
   * One line; text that does not fit ends in an ellipsis. Sets `min-width: 0` so it can shrink
   * inside a flex or grid row. Needs a block box: a flex or grid item, or `as="div"` / `as="p"`.
   */
  truncate?: boolean;
};

/**
 * Body text in one of the shared type roles: size, ink, weight and line height come from props,
 * never from a local class. The defaults are the workbench's most common pair, caption size in
 * the secondary ink. `className` is for placement (margin, grid, width).
 *
 * Migrating feature type to Text: nothing grows, so pick the role equal to the old value or the
 * nearest smaller one. A line height of 1.6 becomes `leading="normal"` (1.5), never `relaxed`
 * (1.625). Text that only set a colour keeps its size with `size="inherit"`; text that only set a
 * size keeps its colour with `tone="inherit"`.
 * @group text
 * @use Supporting text, meta lines, descriptions, values and status text in a feature.
 * @avoid A title of a page, section, card or row: Heading. A caption over a group or list: SectionLabel. Text clamped to several lines: ClampText. A path or id cut in the middle: MiddleTruncate. A field label, help or error: Field.
 * @example
 * <Text>{t("Updated 2 minutes ago")}</Text>
 * <Text as="p" size="body" tone="primary" leading="relaxed">{summary}</Text>
 * <Text size="inherit" tone="danger" weight="medium">{t("Failed")}</Text>
 * <Text truncate className="flex-1">{session.title}</Text>
 */
export function Text({
  as = "span",
  size = "caption",
  tone = "secondary",
  weight,
  leading,
  truncate = false,
  className,
  ...props
}: TextProps) {
  // One prop type for the three tags: they take the same attributes.
  const Tag = as as "span";
  return (
    <Tag
      {...props}
      data-size={size}
      data-tone={tone}
      data-weight={weight}
      data-leading={leading}
      data-truncate={truncate || undefined}
      className={[styles.text, className].filter(Boolean).join(" ")}
    />
  );
}
