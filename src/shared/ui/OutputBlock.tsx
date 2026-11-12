import type { ComponentPropsWithRef } from "react";
import styles from "./OutputBlock.module.css";
import { textAttributes, type TextLeading, type TextTone } from "./Text";

export type OutputBlockProps = ComponentPropsWithRef<"pre"> & {
  /**
   * Type size: `caption` 12px (default), `micro` 11px for dense detail, `secondary` 13px, `body`
   * 14px, `inherit` the surrounding size.
   */
  size?: "micro" | "caption" | "secondary" | "body" | "inherit";
  /** Ink: `secondary` (default), `primary`, a status tone for a failure, `inherit`. */
  tone?: TextTone;
  /** `mono` (default) for commands and logs; `sans` for a message that only keeps its line breaks. */
  face?: "mono" | "sans";
  /**
   * Line spacing: `compact` (default) is the line height of the size; `comfortable` opens the
   * lines to 20px for output that is read rather than scanned.
   */
  density?: "compact" | "comfortable";
  /** Line height override, including `inherit` and `relaxed`; unset keeps density behavior. */
  leading?: TextLeading;
  /**
   * - `none` (default): no box; the surface around it frames it.
   * - `card`: the grouped-card hairline and radius.
   * - `filled`: a quiet raised fill.
   */
  frame?: "none" | "card" | "filled";
  /** Scroll inside the block when it has a maximum height (set the height in `className`). */
  scroll?: boolean;
  /**
   * `true` (default) wraps long lines. `false` keeps each line whole and scrolls horizontally
   * (wide tables, aligned columns).
   */
  wrap?: boolean;
};

/**
 * Preformatted output that keeps its line breaks and wraps long lines: a command result, a log
 * excerpt, a stack trace, an error body. The text is selectable. `className` is for placement and
 * size (margin, `max-h-*`, padding where the frame is `none`).
 * @group text
 * @use Multi-line text produced by a tool, process or server, shown as it was written.
 * @avoid A short literal in a sentence: Code. Highlighted source or a diff: the code and diff viewers. Structured data: JsonViewer. Terminal colours: AnsiText. An error with a summary and details: ErrorDetails.
 * @example
 * <OutputBlock>{stdout}</OutputBlock>
 * <OutputBlock frame="card" scroll className="max-h-48">{log}</OutputBlock>
 * <OutputBlock tone="danger" density="comfortable">{stack}</OutputBlock>
 * <OutputBlock wrap={false} size="body">{table}</OutputBlock>
 */
export function OutputBlock({
  size = "caption",
  tone = "secondary",
  face = "mono",
  density = "compact",
  leading,
  frame = "none",
  scroll = false,
  wrap = true,
  className,
  ...props
}: OutputBlockProps) {
  return (
    <pre
      {...props}
      {...textAttributes(
        { size, tone, leading },
        [styles.block, className].filter(Boolean).join(" "),
      )}
      data-face={face}
      data-density={density}
      data-frame={frame}
      data-scroll={scroll || undefined}
      data-wrap={wrap ? undefined : "false"}
    />
  );
}
