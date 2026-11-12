import { RangePicker, type RangePickerProps } from "./date-time/RangePicker";
export type { DateRange } from "./date-time/values";
export type { DateRangePreset } from "./date-time/presets";
export type { RangePickerProps as DateRangePickerProps } from "./date-time/RangePicker";

/**
 * Inclusive local-day range field with presets, a shared calendar and typed endpoints.
 * @group fields
 * @use A whole-day period as { start: Date; end: Date }; null is empty, onClear clears optional fields.
 * @avoid Exact instants or exclusive end times: DateTimeRangePicker. One day: DatePicker.
 */
export function DateRangePicker(props: RangePickerProps) {
  return <RangePicker {...props} withTime={false} />;
}
