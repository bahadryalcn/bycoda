import { t } from "../../../shared/i18n";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import {
  USAGE_CHART_KINDS,
  type UsageChartKind,
  type UsageChartPanel,
} from "../model/usageChartKinds";

function kindLabel(kind: string) {
  switch (kind) {
    case "line":
      return t("Line");
    case "area":
      return t("Area");
    case "stacked-bar":
      return t("Stacked bar");
    case "cumulative":
      return t("Cumulative");
    case "donut":
      return t("Donut");
    case "bar":
      return t("Bar");
    default:
      return kind;
  }
}

/** The chart-type chooser every Usage panel carries at the end of its header, before any other panel select. */
export function UsageChartKindControl<P extends UsageChartPanel>({
  panel,
  kind,
  onChange,
}: {
  panel: P;
  kind: UsageChartKind<P>;
  onChange: (kind: UsageChartKind<P>) => void;
}) {
  const kinds: readonly string[] = USAGE_CHART_KINDS[panel];
  return (
    <SegmentedControl
      size="sm"
      label={t("Chart type")}
      value={kind}
      onValueChange={(next) => {
        if (kinds.includes(next)) onChange(next as UsageChartKind<P>);
      }}
      options={kinds.map((value) => ({ value, label: kindLabel(value) }))}
    />
  );
}
