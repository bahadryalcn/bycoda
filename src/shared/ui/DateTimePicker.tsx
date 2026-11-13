import type { ComponentProps } from "react";
import { DateTimePanel as Panel } from "./date-time/DateTimePanel";
import { SinglePicker } from "./date-time/SinglePicker";
import type { SinglePickerProps } from "./date-time/types";
export type { DateTimeMode } from "./date-time/values";
export type { SinglePickerProps as DateTimePickerProps } from "./date-time/types";
export {
  parseLocalDate,
  parseLocalTime,
  parseLocalDateTime,
  toLocalDateTime,
  isLocalDateTimeValue,
} from "./date-time/values";

/**
 * Compact local date and time field with a calendar, time columns and typed entry.
 * @group fields
 * @use One local date and time; value is YYYY-MM-DDTHH:mm, empty is "".
 * @avoid Time only: TimePicker. Date only: DatePicker. A period: DateTimeRangePicker.
 * @replaces input[type=datetime-local]
 */
export function DateTimePicker(props: SinglePickerProps) {
  return <SinglePicker {...props} mode="datetime" />;
}

/**
 * The family's calendar, time columns and typed entry on their own: no field frame, no popover.
 * `onChange` reports every complete value as it is chosen; the owner provides the confirm action.
 * @group fields
 * @use Inside a menu, popover or panel that already frames the choice and has its own confirm button.
 * @avoid A form field: DatePicker, TimePicker, DateTimePicker. A period: DateTimeRangePicker.
 */
export function DateTimePanel(props: ComponentProps<typeof Panel>) {
  return <Panel {...props} />;
}
