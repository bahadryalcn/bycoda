import { Text } from "../../../../shared/ui/Text";
import { useState, type ReactNode } from "react";
import { t } from "../../../../shared/i18n";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { NumberField } from "../../../../shared/ui/NumberField";
import { Select } from "../../../../shared/ui/Select";
import { RadioGroup } from "../../../../shared/ui/RadioGroup";
import { ProfileRow, useProfileRows } from "./SettingsProfileRow";
import styles from "../AssistantProfileFields.module.css";
import workStyles from "./work.module.css";

/** Visible select for a saved profile field. Option labels are translated here; an optional one-line hint sits below. */
export function ProfileSelect({
  label,
  value,
  options,
  hint,
  onValueChange,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  hint?: string;
  onValueChange: (next: string) => void;
}) {
  const rows = useProfileRows();
  const select = (
    <Select
      hideLabel={rows}
      label={t(label)}
      value={value}
      options={options.map(([value, label]) => ({ value, label: t(label) }))}
      onValueChange={onValueChange}
    />
  );
  if (rows)
    return (
      <ProfileRow label={t(label)} description={hint ? t(hint) : undefined}>
        {() => select}
      </ProfileRow>
    );
  if (!hint) return select;
  return (
    <div className={workStyles.field}>
      {select}
      <Text as="p" leading="snug" className={workStyles.hint}>
        {t(hint)}
      </Text>
    </div>
  );
}

/** Small segmented choice under the same legend role as the model fields. */
export function ProfileSegmented({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onValueChange: (next: string) => void;
}) {
  const segmented = (
    <RadioGroup
      variant="inline"
      label={t(label)}
      value={value}
      options={options.map(([value, label]) => ({ value, label: t(label) }))}
      onValueChange={onValueChange}
    />
  );
  if (useProfileRows()) return <ProfileRow label={t(label)}>{() => segmented}</ProfileRow>;
  return <FieldGroup legend={t(label)}>{segmented}</FieldGroup>;
}

/** Integer draft that keeps invalid text visible until the owner corrects it. */
export function ProfileNumber({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: unknown;
  min: number;
  max: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  const [raw, setRaw] = useState(String(value ?? ""));
  const endAdornment: ReactNode = unit ? (
    <Text size="micro" tone="secondary" leading="inherit" className={styles.unit}>
      {t(unit)}
    </Text>
  ) : undefined;
  return (
    <ProfileRow label={t(label)}>
      {(hideLabel) => (
        <NumberField
          label={t(label)}
          hideLabel={hideLabel}
          value={raw}
          min={min}
          max={max}
          step={1}
          steppers={false}
          required
          endAdornment={endAdornment}
          onChange={(event) => {
            const text = event.currentTarget.value;
            setRaw(text);
            onChange(text.trim() ? Number(text) : Number.NaN);
          }}
        />
      )}
    </ProfileRow>
  );
}
