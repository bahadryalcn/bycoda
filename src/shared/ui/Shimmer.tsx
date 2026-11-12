import { memo, type CSSProperties, type ElementType } from "react";
import { optionalTextAttributes, type TextSize, type TextTone, type TextRoles } from "./Text";

export interface ShimmerProps {
  children: string;
  as?: ElementType;
  className?: string;
  /** Text roles; unset preserves existing styling. */
  size?: TextSize;
  tone?: TextTone;
  weight?: TextRoles["weight"];
  /** Line height role; `inherit` keeps the surrounding line height. */
  leading?: TextRoles["leading"];
  /** One line with an ellipsis. */
  truncate?: boolean;
  duration?: number;
  spread?: number;
}

function ShimmerComponent({
  children,
  as: Component = "span",
  className = "",
  duration = 2,
  spread = 2,
  size,
  tone,
  weight,
  leading,
  truncate,
}: ShimmerProps) {
  const dynamicSpread = (children?.length ?? 0) * spread;

  return (
    <Component
      {...optionalTextAttributes(
        { size: size ?? (weight ? "inherit" : undefined), tone, weight, leading, truncate },
        `shimmer-text relative inline-block ${className}`.trim(),
      )}
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
