import { SinglePicker } from "./date-time/SinglePicker";
import type { SinglePickerProps } from "./date-time/types";
export type { SinglePickerProps as TimePickerProps } from "./date-time/types";

/**
 * Compact time field with locale-aware hour/minute columns and typed entry.
 * @group fields
 * @use One local time; value is 24-hour HH:mm, empty is "". minuteStep controls minute options.
 * @avoid A date and time: DateTimePicker. A date: DatePicker.
 * @replaces input[type=time]
 */
export function TimePicker(props: SinglePickerProps) {
  return <SinglePicker {...props} mode="time" />;
}
