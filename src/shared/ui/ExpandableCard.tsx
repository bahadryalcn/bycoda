import {
  ExpandableCard as ArcExpandableCard,
  type ExpandableCardProps,
} from "./arc/expandable-card/expandable-card";

export function ExpandableCard({ className, ...props }: ExpandableCardProps) {
  return (
    <ArcExpandableCard
      {...props}
      className={["bycoda-arc bycoda-arc-card", className].filter(Boolean).join(" ")}
    />
  );
}
