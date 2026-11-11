import { memo, type CSSProperties, type ElementType } from "react";

export interface ShimmerProps {
  children: string;
  as?: ElementType;
  className?: string;
  duration?: number;
  spread?: number;
}

function ShimmerComponent({
  children,
  as: Component = "span",
  className = "",
  duration = 2,
  spread = 2,
}: ShimmerProps) {
  const dynamicSpread = (children?.length ?? 0) * spread;

  return (
    <Component
      className={`shimmer-text relative inline-block ${className}`.trim()}
      style={
        {
          "--spread": `${dynamicSpread}px`,
          "--shimmer-duration": `${duration}s`,
        } as CSSProperties
      }
    >
      {children}
    </Component>
  );
}

/**
 * Decorative text with a moving highlight sweep that signals ongoing work; the sweep stops under reduced motion.
 * Text only: the adjacent status owns the live announcement, so do not wrap it in another live region.
 * @group feedback
 * @use Label of an in-progress agent step (Thinking, Running) in a transcript or activity row.
 * @avoid Static product copy. Standard loading line: LoadingText. Glyph on a button: Spinner. Final layout known: Skeleton.
 */
export const Shimmer = memo(ShimmerComponent);
