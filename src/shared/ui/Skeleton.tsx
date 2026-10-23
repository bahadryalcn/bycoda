import { useT } from "../i18n";
import { Skeleton as ArcSkeleton, type SkeletonProps } from "./arc/skeleton/skeleton";
export type { SkeletonProps } from "./arc/skeleton/skeleton";

export function Skeleton({ label, className, ...props }: SkeletonProps) {
  const t = useT();
  return (
    <ArcSkeleton
      {...props}
      label={label ?? t("Loading…")}
      className={["bycoda-arc", className].filter(Boolean).join(" ")}
    />
  );
}
