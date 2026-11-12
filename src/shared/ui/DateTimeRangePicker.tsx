import { RangePicker, type RangePickerProps } from "./date-time/RangePicker";
export type { DateRange as DateTimeRange } from "./date-time/values";
export type { RangePickerProps as DateTimeRangePickerProps } from "./date-time/RangePicker";

/**
 * Exact local start/end instants with shared calendar, time columns and presets; end is exclusive.
 * @group fields
 * @use A reporting period as { start: Date; end: Date }; null is empty, onClear clears optional fields.
 * @avoid Whole-day inclusive ranges: DateRangePicker. One instant: DateTimePicker.
 */
export function DateTimeRangePicker(props: RangePickerProps) {
  return <RangePicker {...props} withTime />;
}
