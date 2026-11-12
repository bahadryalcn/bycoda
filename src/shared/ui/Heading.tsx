import type { ComponentPropsWithRef, CSSProperties } from "react";
import styles from "./Heading.module.css";
import textStyles from "./Text.module.css";
import type { TextTone, TextLeading } from "./Text";

/** Title roles of the workbench, including a prominent introduction. */
export type HeadingSize = "page" | "section" | "item" | "caption" | "heading";

export type HeadingProps = ComponentPropsWithRef<"h2"> & {
  /** Use a non-heading title inside a pane that already has an outline heading. */
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "div";
  /**
   * - `page`: the title of a page, dialog body or full view (16px).
   * - `section`: a section inside a page (14px). Default.
   * - `item`: the title of a card, row or list entry (13px).
   * - `caption`: the title of a compact window, popover or dense tool header (12px).
   * - `heading`: a prominent introduction title (20px), default outline level 1.
   */
  size?: HeadingSize;
  /** Document outline level. Default: page 1, section 2, item 3. Size never follows the level. */
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Explicit shared line height; unset keeps the title role. */
  leading?: TextLeading;
  /** Clip a single line with an ellipsis. */
  truncate?: boolean;
  /** Clamp to this many lines with an ellipsis and no "Show more" (see ClampText `expandable={false}`). */
  lines?: number;
  /** Ink; unset keeps the content ink. A status tone for a title that reports one. */
  tone?: TextTone;
};

const DEFAULT_LEVEL = { page: 1, section: 2, item: 3, caption: 3, heading: 1 } as const;

/**
 * The one title: size comes from the role (`page`, `section`, `item`, `caption`), never from the tag or a
 * local class, so the same role looks the same on every screen. Weight is medium, ink is the
 * content tone. `level` only sets the outline tag. `className` is for placement (margin, grid).
 * @group layout
 * @replaces h1 h2 h3 h4 h5 h6
 * @use Any page, section, card or row title in a feature.
 * @avoid A quiet caption over a group or list: SectionLabel. A pane or tool header row: PaneHeader. Dialog titles: Modal / Sheet `title`.
 * @example
 * <Heading size="section">{t("Activity")}</Heading>
 * <Heading size="item" level={4}>{card.title}</Heading>
 * <Heading size="caption" leading="inherit" truncate>{card.title}</Heading>
 * <Heading size="item" lines={2} tone="danger">{card.title}</Heading>
 */
export function Heading({
  as,
  size = "section",
  level,
  leading,
  truncate,
  lines,
  tone,
  className,
  style,
  ...props
}: HeadingProps) {
  const Tag = (as ?? `h${level ?? DEFAULT_LEVEL[size]}`) as "h2";
  return (
    <Tag
      {...props}
      style={lines ? ({ ...style, "--clamp-lines": lines } as CSSProperties) : style}
      data-lines={lines || undefined}
      data-tone={tone}
      data-size={size}
      data-leading={leading}
      data-truncate={truncate || undefined}
      className={[styles.heading, (tone || leading) && textStyles.text, className]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
