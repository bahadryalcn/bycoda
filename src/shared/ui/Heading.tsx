import type { ComponentPropsWithRef } from "react";
import styles from "./Heading.module.css";

/** The four title roles of the workbench. */
export type HeadingSize = "page" | "section" | "item" | "caption";

export type HeadingProps = ComponentPropsWithRef<"h2"> & {
  /**
   * - `page`: the title of a page, dialog body or full view (16px).
   * - `section`: a section inside a page (14px). Default.
   * - `item`: the title of a card, row or list entry (13px).
   * - `caption`: the title of a compact window, popover or dense tool header (12px).
   */
  size?: HeadingSize;
  /** Document outline level. Default: page 1, section 2, item 3. Size never follows the level. */
  level?: 1 | 2 | 3 | 4 | 5 | 6;
};

const DEFAULT_LEVEL = { page: 1, section: 2, item: 3, caption: 3 } as const;

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
 */
export function Heading({ size = "section", level, className, ...props }: HeadingProps) {
  const Tag = `h${level ?? DEFAULT_LEVEL[size]}` as "h2";
  return (
    <Tag
      {...props}
      data-size={size}
      className={[styles.heading, className].filter(Boolean).join(" ")}
    />
  );
}
