import { useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { Field } from "../../../shared/ui/Field";
import { NumberField } from "../../../shared/ui/NumberField";
import { Select } from "../../../shared/ui/Select";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Switch } from "../../../shared/ui/Switch";
import styles from "./AssistantProfileFields.module.css";

/** Exact values remain drafts until the owner saves the surrounding form. */
export function AssistantPresetNumber({
  label,
  value,
  min,
  max,
  presets,
  unit,
  onChange,
}: {
  label: string;
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
  return (
    <Field label={label}>
      {(control) => (
        <div className={styles.presetControls}>
          <Select
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
              endAdornment={<span className={styles.unit}>{unit}</span>}
              onChange={(event) => {
                const raw = event.currentTarget.value;
                const parsed = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
                const number =
                  Number.isSafeInteger(parsed) && parsed >= min && parsed <= max
                    ? parsed
                    : Number.NaN;
                setDraft({ source: number, raw, custom: true });
                onChange(number);
              }}
            />
          )}
        </div>
      )}
    </Field>
  );
}

const hours = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, "0")}:00`,
}));

export function AssistantHourRange({
  kind,
  start,
  end,
  onChange,
}: {
  kind: "work" | "quiet";
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
}) {
  const work = kind === "work";
  const remembered = useRef(
    start !== end ? { start, end } : work ? { start: 9, end: 17 } : { start: 22, end: 8 },
  );
  if (start !== end) remembered.current = { start, end };
  const enabled = start !== end;
  const [editingRange, setEditingRange] = useState(enabled);
  return (
    <div className={styles.hourRange}>
      <Switch
        label={work ? t("Work all day") : t("Quiet hours")}
        checked={work ? !enabled : enabled}
        onCheckedChange={(checked) => {
          const rangeEnabled = work ? !checked : checked;
          setEditingRange(rangeEnabled);
          if (rangeEnabled) onChange(remembered.current.start, remembered.current.end);
          else onChange(start, start);
        }}
      />
      {(enabled || editingRange) && (
        <div className={styles.hourPair}>
          <SearchableSelect
            label={work ? t("Work hours start") : t("Quiet hours start")}
            visibleLabel
            value={String(start)}
            options={hours}
            onChange={(value) => {
              setEditingRange(true);
              onChange(Number(value), end);
            }}
          />
          <SearchableSelect
            label={work ? t("Work hours end") : t("Quiet hours end")}
            visibleLabel
            value={String(end)}
            options={hours}
            onChange={(value) => {
              setEditingRange(true);
              onChange(start, Number(value));
            }}
          />
        </div>
      )}
    </div>
  );
}
