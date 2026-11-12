import type { ComponentPropsWithRef } from "react";
import styles from "./Code.module.css";
import { textAttributes, type TextSize, type TextTone, type TextRoles } from "./Text";

export type CodeProps = ComponentPropsWithRef<"code"> & {
  /**
   * - `plain` (default): monospaced text in the line, no box.
   * - `chip`: a quiet filled box around a short value (a command, a flag, an id).
   * - `block`: the value on its own line in a filled box, selectable as a whole.
   */
  variant?: "plain" | "chip" | "block";
  /** Type size from the shared scale; `inherit` (default) follows the surrounding text. */
  size?: TextSize;
  /** Ink; `inherit` (default) follows the surrounding text. */
  tone?: TextTone;
  /** Literal weight; unset inherits. */
  weight?: TextRoles["weight"];
  /** Literal tracking; unset inherits, wider suits device codes. */
  tracking?: TextRoles["tracking"];
};

/**
 * A short literal value in the monospaced face: a command, a flag, a path fragment, a key, an id.
 * `className` is for placement and wrapping (margin, `break-all`, `select-all`).
 * @group text
 * @use A literal the reader may type or copy, inside a sentence or on its own line.
 * @avoid Several lines of output or a log: OutputBlock. Highlighted source: the code viewer. A keyboard shortcut: ShortcutKbd. A path that must fit a row: MiddleTruncate.
 * @example
 * <Code>{flag}</Code>
 * <Code variant="chip" size="micro" tone="secondary">{command}</Code>
 * <Code variant="block" tone="primary">{url}</Code>
 */
export function Code({
  variant = "plain",
  size = "inherit",
  tone = "inherit",
  weight,
  tracking,
  className,
  ...props
}: CodeProps) {
  return (
    <code
      {...props}
      {...textAttributes(
        { size, tone, weight, tracking },
        [styles.code, className].filter(Boolean).join(" "),
      )}
      data-variant={variant}
    />
  );
}
