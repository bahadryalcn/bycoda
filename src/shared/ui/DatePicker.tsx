import { SinglePicker } from "./date-time/SinglePicker";
import type { SinglePickerProps } from "./date-time/types";
export type { SinglePickerProps as DatePickerProps } from "./date-time/types";

/**
 * Compact local-day field with keyboard calendar navigation and typed entry.
 * @group fields
 * @use One local date; value is YYYY-MM-DD, empty is "".
 * @avoid A time: TimePicker. A date and time: DateTimePicker. A period: DateRangePicker.
 * @replaces input[type=date]
 */
export function DatePicker(props: SinglePickerProps) {
  return <SinglePicker {...props} mode="date" />;
}
