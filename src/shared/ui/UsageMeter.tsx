import { UsageMeter as ArcUsageMeter, type UsageMeterProps } from "./arc/usage-meter/usage-meter";
import { useT } from "../i18n";
import type { CSSProperties } from "react";

/**
 * Quota bar showing used and remaining amount with "Remaining" / "Over limit" copy; `color` sets the account
 * or series color.
 * @group data
 * @use Used vs limit for a quota, budget or rate window, optionally with reset time.
 * @avoid Generic bounded measure: Meter. Task progress: Progress. Exact values for comparison: a table.
 * @arc usage-meter
 */
export function UsageMeter({ color, ...props }: UsageMeterProps & { color?: string }) {
  const t = useT();
  return (
    <div
      className="bycoda-arc bycoda-arc-usage bycoda-chart-colors"
      style={color ? ({ "--usage-color": color } as CSSProperties) : undefined}
    >
      <ArcUsageMeter freeLabel={t("Remaining")} overLabel={t("Over limit")} {...props} />
    </div>
  );
}
