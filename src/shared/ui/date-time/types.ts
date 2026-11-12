import type { FieldVariant } from "../Field";
import type { DateTimeMode } from "./values";

export type PickerFieldProps = {
  label: string;
  hint?: string;
  description?: string;
  error?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  placeholder?: string;
  clearable?: boolean;
  hideLabel?: boolean;
  fieldVariant?: FieldVariant;
  fieldSize?: "sm" | "md";
  id?: string;
  name?: string;
  className?: string;
};
export type SinglePickerProps = PickerFieldProps & {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  minuteStep?: number;
};
export type DateTimeFieldProps = SinglePickerProps & { mode?: DateTimeMode };
