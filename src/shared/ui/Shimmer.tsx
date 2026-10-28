import { memo, useMemo, type CSSProperties, type ElementType } from "react";

export interface ShimmerProps {
  children: string;
  as?: ElementType;
  className?: string;
  duration?: number;
  spread?: number;
}

/**
 * Decorative working label. It carries text only; the adjacent status owns the live
 * announcement, so do not wrap it in another live region. Its sweep, where a host
 * surface adds one through `.shimmer-text`, must stop for reduced motion.
 */
function ShimmerComponent({
  children,
  as: Component = "span",
  className = "",
  duration = 2,
  spread = 2,
}: ShimmerProps) {
  const dynamicSpread = useMemo(() => (children?.length ?? 0) * spread, [children, spread]);

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

export const Shimmer = memo(ShimmerComponent);
