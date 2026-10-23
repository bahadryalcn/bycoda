import { useT } from "../i18n";
import { Progress as ArcProgress, type ProgressProps } from "./arc/progress/progress";
export type { ProgressProps } from "./arc/progress/progress";

/** Missing value is indeterminate; callers retain operation and quota semantics. */
export function Progress({ className, ...props }: ProgressProps) {
  const t = useT();
  return (
    <ArcProgress
      {...props}
      aria-label={props["aria-label"] ?? props.label ?? t("Progress")}
      className={["bycoda-arc", className].filter(Boolean).join(" ")}
    />
  );
}
