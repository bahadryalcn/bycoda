import type { CSSProperties } from "react";
import { Badge as ArcBadge, type BadgeProps as ArcBadgeProps } from "./arc/badge/badge";

export type {
  BadgeTone,
  BadgeSize,
  BadgeVariant,
  BadgeAppearance,
} from "./arc/badge/badge";

export type BadgeProps = ArcBadgeProps & { minWidth?: CSSProperties["minInlineSize"] };

/** Concise status presentation; domain-to-tone mapping remains with the caller. */
export function Badge({ className, minWidth, style, ...props }: BadgeProps) {
  return <ArcBadge {...props} style={{ ...style, minInlineSize: minWidth ?? style?.minInlineSize }} className={["bycoda-arc", className].filter(Boolean).join(" ")} />;
}
