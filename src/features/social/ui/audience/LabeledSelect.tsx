import { Field } from "../../../../shared/ui/Field";
import { NativeSelect } from "../../../../shared/ui/Select";

export type LabeledSelectOption = { value: string; label: string; disabled?: boolean };

export type LabeledSelectProps = {
  label: string;
  value: string;
  options: readonly LabeledSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  description?: string;
};

/** Native select inside the shared Field: label, help text and FormData behave like any form control. */
export function LabeledSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  hideLabel,
  description,
}: LabeledSelectProps) {
  return (
    <Field label={label} hideLabel={hideLabel} description={description} variant="compact">
      {(control) => (
        <NativeSelect
          {...control}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      )}
    </Field>
  );
}
