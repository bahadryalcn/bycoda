import { Badge as ArcBadge, type BadgeProps } from "./arc/badge/badge";

export type { BadgeProps, BadgeTone, BadgeSize } from "./arc/badge/badge";

/** Concise status presentation; domain-to-tone mapping remains with the caller. */
export function Badge({ className, ...props }: BadgeProps) {
  return <ArcBadge {...props} className={["bycoda-arc", className].filter(Boolean).join(" ")} />;
}
