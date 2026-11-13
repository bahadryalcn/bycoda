import type { ComponentPropsWithoutRef } from "react";
import styles from "./Spinner.module.css";
import { optionalTextAttributes, type TextTone } from "./Text";

export type SpinnerSize = "micro" | "xs" | "sm" | "md";

export type SpinnerProps = Omit<ComponentPropsWithoutRef<"span">, "children"> & {
  /** `sm` (default) matches `icon-sm` (14px), `xs` `icon-xs` (12px), `md` `icon-md` (16px).
   * `micro` keeps dense inline provider-status slots at 10px. */
  size?: SpinnerSize;
  /** Accessible name. Omit when the initiating control already announces progress (aria-busy). */
  label?: string;
  /** Glyph ink; unset inherits the surrounding colour. */
  tone?: TextTone;
  /**
   * Inside running text or a label: the glyph follows the surrounding font size (1em) and sits
   * on the text line instead of the icon box. `size` is ignored.
   */
  inline?: boolean;
};

/**
 * The one pending glyph: `size` xs/sm/md match icon sizes, `inline` follows the text size, `currentColor`, pulses under reduced motion.
 * Pass `label` only when nothing else announces progress; otherwise the initiating control's aria-busy does.
 * @group feedback
 * @use Short pending state on the control that started the work (button, row action, inline label).
 * @avoid Standard loading line: LoadingText. Surface/page loading: SurfaceLoading. Known final layout: Skeleton. Agent working: WorkingIndicator. Never spin a lucide Loader icon.
 */
export function Spinner({
  size = "sm",
  label,
  inline = false,
  className,
  tone,
  ...props
}: SpinnerProps) {
  return (
    <span
      {...props}
      {...optionalTextAttributes({ tone }, [styles.spinner, className].filter(Boolean).join(" "))}
      data-size={inline ? "inline" : size}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
