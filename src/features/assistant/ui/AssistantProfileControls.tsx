import { Text } from "../../../shared/ui/Text";
import { useState } from "react";
import { t } from "../../../shared/i18n";
import { Field } from "../../../shared/ui/Field";
import { NumberField } from "../../../shared/ui/NumberField";
import { Select } from "../../../shared/ui/Select";
import { ProfileRow, useProfileRows } from "./settings/SettingsProfileRow";
import styles from "./AssistantProfileFields.module.css";

/** Exact values remain drafts until the owner saves the surrounding form. */
export function AssistantPresetNumber({
  label,
  value,
  min,
  max,
  presets,
  unit,
  description,
  onChange,
}: {
  label: string;
  /** One line under the settings row label. */
  description?: string;
  value: unknown;
  min: number;
  max: number;
  presets: readonly { value: number; label: string }[];
  unit: string;
  onChange: (value: number) => void;
}) {
  const initial = (source: unknown) => ({
    source,
    raw: String(source ?? ""),
    custom: !presets.some((option) => option.value === source),
  });
  const [draft, setDraft] = useState(() => initial(value));
  if (!Object.is(draft.source, value)) setDraft(initial(value));
  const selected = draft.custom ? "custom" : String(value);
  const body = (control?: object) => (
    <div className={styles.presetControls}>
      <Select
        hideLabel
        {...control}
        label={label}
        value={selected}
        options={[
          ...presets.map((option) => ({ value: String(option.value), label: option.label })),
          { value: "custom", label: value === 0 && min > 0 ? t("Not set") : t("Custom") },
        ]}
        onValueChange={(next) => {
          if (next === "custom") {
            setDraft((current) => ({ ...current, custom: true }));
            return;
          }
          const number = Number(next);
          setDraft({ source: number, raw: next, custom: false });
          onChange(number);
        }}
      />
      {draft.custom && (
        <NumberField
          label={t("Custom {p0}", { p0: label })}
          hideLabel
          value={draft.raw}
          min={min}
          max={max}
          step={1}
          steppers={false}
          required
          endAdornment={
            <Text size="micro" tone="secondary" leading="inherit" className={styles.unit}>
              {unit}
            </Text>
          }
          onChange={(event) => {
            const raw = event.currentTarget.value;
            const parsed = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
            const number =
              Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : Number.NaN;
            setDraft({ source: number, raw, custom: true });
            onChange(number);
          }}
        />
      )}
    </div>
  );
  // The settings dialog's row owns the visible label; the setup form keeps the field label.
  if (useProfileRows())
    return (
      <ProfileRow label={label} description={description}>
        {() => body()}
      </ProfileRow>
    );
  return <Field label={label}>{(control) => body(control)}</Field>;
}
