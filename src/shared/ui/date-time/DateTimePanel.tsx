import { useT } from "../../i18n";
import { CalendarGrid } from "./CalendarGrid";
import { TimeColumns } from "./TimeColumns";
import { ValueEntry } from "./ValueEntry";
import { clampValue, dateKey, parseLocalTime, type DateTimeMode } from "./values";
import styles from "./Pickers.module.css";

export function DateTimePanel({
  value,
  onChange,
  mode = "datetime",
  min,
  max,
  minDate,
  autoFocus,
  disabled,
  readOnly,
  minuteStep,
  onValidityChange,
  onDatePick,
}: {
  value: string;
  onChange: (value: string) => void;
  mode?: DateTimeMode;
  min?: string;
  max?: string;
  minDate?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  minuteStep?: number;
  onValidityChange?: (valid: boolean) => void;
  /** Date mode only: a day chosen in the calendar, already clamped. */
  onDatePick?: (value: string) => void;
}) {
  const t = useT();
  const time = mode === "time" ? value : value.slice(11);
  const minimum = min ?? minDate;
  const update = (next: string) => {
    if (!disabled && !readOnly) onChange(clampValue(next, mode, minimum, max));
  };
  return (
    <div className={styles.panel}>
      {mode !== "time" ? (
        <CalendarGrid
          value={value.slice(0, 10)}
          min={minimum?.slice(0, 10)}
          max={max?.slice(0, 10)}
          disabled={disabled}
          readOnly={readOnly}
          autoFocus={autoFocus}
          onChange={(date) => {
            if (mode === "date") {
              update(dateKey(date));
              if (!disabled && !readOnly)
                onDatePick?.(clampValue(dateKey(date), mode, minimum, max));
            } else update(`${dateKey(date)}T${parseLocalTime(time) !== null ? time : "00:00"}`);
          }}
        />
      ) : null}
      {mode !== "date" ? (
        <TimeColumns
          value={time}
          minuteStep={minuteStep}
          disabled={disabled || readOnly}
          onChange={(next) => update(mode === "time" ? next : `${value.slice(0, 10)}T${next}`)}
        />
      ) : null}
      <ValueEntry
        value={value}
        mode={mode}
        onChange={update}
        onValidityChange={onValidityChange}
        disabled={disabled || readOnly}
        label={mode === "date" ? t("Date") : mode === "time" ? t("Time") : t("Date and time")}
      />
    </div>
  );
}
