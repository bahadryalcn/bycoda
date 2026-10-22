import { UsageMeter as ArcUsageMeter, type UsageMeterProps } from "./arc/usage-meter/usage-meter";
import { t, useLocale } from "../i18n";
import type { CSSProperties } from "react";

export function UsageMeter({ color, ...props }: UsageMeterProps & { color?: string }) {
  useLocale();
  return (
    <div
      className="bycoda-arc bycoda-arc-usage"
      style={color ? ({ "--usage-color": color } as CSSProperties) : undefined}
    >
      <ArcUsageMeter freeLabel={t("Remaining")} overLabel={t("Over limit")} {...props} />
    </div>
  );
}
