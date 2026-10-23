import {
  DateRangePicker as ArcDateRangePicker,
  defaultDateRangePresets,
  type DateRangePickerProps,
} from "./arc/date-range-picker/date-range-picker";
import { getLocale, useT } from "../i18n";

export type { DateRange } from "./arc/date-range-picker/date-range-picker";

export function DateRangePicker(props: DateRangePickerProps) {
  const t = useT();
  return (
    <ArcDateRangePicker
      locale={getLocale()}
      weekStartsOn={1}
      label={t("Date range")}
      placeholder={t("Custom date range")}
      presets={defaultDateRangePresets.map((preset) => ({ ...preset, label: t(preset.label) }))}
      {...props}
      className={["bycoda-arc bycoda-arc-date-range", props.className].filter(Boolean).join(" ")}
    />
  );
}
