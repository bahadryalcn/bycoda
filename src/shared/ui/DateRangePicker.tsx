import {
  DateRangePicker as ArcDateRangePicker,
  defaultDateRangePresets,
  type DateRangePickerProps,
} from "./arc/date-range-picker/date-range-picker";
import { useLocale, useT } from "../i18n";

export type { DateRange } from "./arc/date-range-picker/date-range-picker";

/**
 * Inclusive local-day range calendar with presets. Only used inside DateTimeRangePicker; features use that component instead.
 * @group fields
 * @status internal
 */
export function DateRangePicker(props: DateRangePickerProps) {
  const t = useT();
  const locale = useLocale();
  return (
    <ArcDateRangePicker
      locale={locale}
      weekStartsOn={1}
      label={t("Date range")}
      placeholder={t("Custom date range")}
      presets={defaultDateRangePresets.map((preset) => ({ ...preset, label: t(preset.label) }))}
      {...props}
      className={["bycoda-arc bycoda-arc-date-range", props.className].filter(Boolean).join(" ")}
    />
  );
}
