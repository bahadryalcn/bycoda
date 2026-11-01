import { useLayoutEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { MiddleTruncate } from "./MiddleTruncate";
import { OverflowTooltip } from "./Tooltip";

export type TabLabelProps = {
  children: string;
  className?: string;
  /** `end` fades only text that is actually clipped; `middle` keeps the end of the name (file extension, suffix). */
  truncate?: "end" | "middle";
  /** Characters kept visible at the end when `truncate="middle"`. */
  tail?: number;
  /** Tooltip with the full text while it is clipped. Pass `true` for the label itself; omit when the tab already
   *  has its own title. */
  title?: boolean | string;
};

/** Keep short tab labels clear, fading only text that is actually clipped. */
export function TabLabel({
  children,
  className = "",
  truncate = "end",
  tail,
  title,
}: TabLabelProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  const middle = truncate === "middle";
  const full = title === true ? children : title || undefined;

  useLayoutEffect(() => {
    const label = ref.current;
    if (!label || middle) return;
    const measure = () => {
      setOverflow(label.clientWidth > 0 && label.scrollWidth > label.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(label);
    return () => observer.disconnect();
  }, [children, middle]);

  if (middle)
    return (
      <MiddleTruncate
        mode="text"
        tail={tail}
        title={full ?? false}
        className={`tab-label ${className}`}
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
        className={`tab-label min-w-0 truncate ${className}`}
      >
        {children}
      </span>
    </OverflowTooltip>
  );
}

/** Unsaved-changes mark shared by every tab strip: same size, role and name everywhere. */
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
