import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { MiddleTruncate } from "./MiddleTruncate";
import { OverflowTooltip } from "./Tooltip";
import {
  optionalTextAttributes,
  type TextLeading,
  type TextSize,
  type TextTone,
  type TextRoles,
} from "./Text";

export type TabLabelProps = {
  children: string;
  className?: string;
  /** Text roles; unset preserves existing styling. */
  size?: TextSize;
  tone?: TextTone;
  weight?: TextRoles["weight"];
  /** Line height; unset keeps the surrounding one. Replaces `leading-*` classes. */
  leading?: TextLeading;
  /** `end` fades only text that is actually clipped; `middle` keeps the end of the name (file extension, suffix). */
  truncate?: "end" | "middle";
  /** Characters kept visible at the end when `truncate="middle"`. */
  tail?: number;
  /** Tooltip with the full text while it is clipped. Pass `true` for the label itself; omit when the tab already
   *  has its own title. */
  title?: boolean | string;
};

/**
 * Tab label text that truncates only when clipped: `end` fades the tail, `middle` keeps a suffix such as a file
 * extension. Shows the full text in a tooltip while clipped when `title` is set.
 * @group text
 * @use Label inside a draggable workspace or editor tab whose name can be long.
 * @avoid Plain `Tab` label text in Tabs (short fixed copy). Any other clipped text: OverflowTooltip or MiddleTruncate.
 */
export function TabLabel({
  children,
  className = "",
  truncate = "end",
  tail,
  title,
  size,
  tone,
  weight,
  leading,
}: TabLabelProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  const middle = truncate === "middle";
  const full = title === true ? children : title || undefined;

  const measure = useCallback(() => {
    const label = ref.current;
    if (!label || middle) return;
    setOverflow(label.clientWidth > 0 && label.scrollWidth > label.clientWidth);
  }, [middle]);
  useLayoutEffect(measure, [children, measure]);
  useLayoutEffect(() => {
    const label = ref.current;
    if (!label || middle) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(label);
    return () => observer.disconnect();
  }, [measure, middle]);

  if (middle)
    return (
      <MiddleTruncate
        mode="text"
        tail={tail}
        title={full ?? false}
        {...optionalTextAttributes(
          { size: size ?? (weight ? "inherit" : undefined), tone, weight, leading },
          `tab-label ${className}`,
        )}
      >
        {children}
      </MiddleTruncate>
    );

  const tooltip = overflow ? full : undefined;
  return (
    <OverflowTooltip label={tooltip}>
      <span
        ref={ref}
        data-overflow={overflow || undefined}
        {...optionalTextAttributes(
          { size: size ?? (weight ? "inherit" : undefined), tone, weight, leading },
          `tab-label min-w-0 truncate ${className}`,
        )}
      >
        {children}
      </span>
    </OverflowTooltip>
  );
}

/**
 * Unsaved-changes dot with a fixed size, `img` role and "Unsaved changes" name, shared by every tab strip.
 * @group feedback
 * @use Mark a tab or editor title with unsaved edits.
 * @avoid Generic status marks: StatusDot.
 */
export function TabDirtyDot({ className = "" }: { className?: string }) {
  const label = useT()("Unsaved changes");
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`size-1.5 shrink-0 rounded-full bg-(--ui-text-secondary) ${className}`}
    />
  );
}
