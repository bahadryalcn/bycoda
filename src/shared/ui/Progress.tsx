import { useT } from "../i18n";
import { Progress as ArcProgress, type ProgressProps } from "./arc/progress/progress";
export type { ProgressProps } from "./arc/progress/progress";

/**
 * Determinate or indeterminate progress bar of an operation; a missing `value` is indeterminate, never a fake percent.
 * Gets a default accessible name; pass `label` when it can be more specific.
 * @group feedback
 * @use Measurable or running operation (upload, import, setup step) with a known or unknown end.
 * @avoid Capacity or level readout: Meter. Quota used/remaining: UsageMeter. Spinner-only wait: LoadingText.
 * @arc progress
 */
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
