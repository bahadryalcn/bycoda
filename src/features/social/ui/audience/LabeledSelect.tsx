import type { ReactNode } from "react";
import { Select } from "../../../../shared/ui/Select";

export type LabeledSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  icon?: ReactNode;
};

export type LabeledSelectProps = {
  label: string;
  value: string;
  options: readonly LabeledSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  description?: string;
  /** Validation message under the select. */
  error?: string;
};

/**
 * The Audience forms keep their values in React state, so their choices use the shared Select
 * (label, description and error composed by it), the same control as the sibling pickers.
 */
export function LabeledSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  hideLabel,
  description,
  error,
}: LabeledSelectProps) {
  return (
    <Select
      label={label}
      value={value}
      options={[...options]}
      onValueChange={onChange}
      disabled={disabled}
      hideLabel={hideLabel}
      description={description}
      error={error}
    />
  );
}
