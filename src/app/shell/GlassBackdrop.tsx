import type { Ref } from "react";

/**
 * Keep the opaque floating surface beside the interactive content, inside a
 * positioned, isolated frame. It paints no backdrop blur: the surface covers
 * what is behind it. Add a filter only through a deliberately translucent
 * class such as `popover-frosted`.
 */
export function GlassBackdrop({
  className = "popover-backdrop",
  ref,
}: {
  className?: string;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-0 [border-radius:inherit] ${className}`}
    />
  );
}
