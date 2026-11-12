import { useState, type ReactNode } from "react";
import { useT } from "../../i18n";
import { useCalendarFormat } from "../../i18n/calendar";
import { Button } from "../Button";
import { DateTimePanel } from "./DateTimePanel";
import { PickerShell } from "./PickerShell";
import type { DateTimeFieldProps } from "./types";
import { clampValue, formatValue, isLocalDateTimeValue, toLocalDateTime } from "./values";
import styles from "./Pickers.module.css";

function SingleEditor({
  value,
  mode = "datetime",
  onChange,
  close,
  clear,
  ...props
}: DateTimeFieldProps & { close: () => void; clear: ReactNode }) {
  const t = useT();
  const [entryValid, setEntryValid] = useState(true);
  const [draft, setDraft] = useState(() => {
    if (isLocalDateTimeValue(value, mode)) return clampValue(value, mode, props.min, props.max);
    const now = toLocalDateTime(new Date());
    return clampValue(
      mode === "date" ? now.slice(0, 10) : mode === "time" ? now.slice(11) : now,
      mode,
      props.min,
      props.max,
    );
  });
  return (
    <>
      <DateTimePanel
        {...props}
        value={draft}
        mode={mode}
        onChange={setDraft}
        onValidityChange={setEntryValid}
        onDatePick={(next) => {
          onChange(next);
          close();
        }}
        autoFocus={mode !== "time"}
      />
      <div className={styles.footer}>
        {clear}
        <Button variant="ghost" size="sm" onClick={close}>
          {t("Cancel")}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={
            !entryValid ||
            !isLocalDateTimeValue(draft, mode) ||
            clampValue(draft, mode, props.min, props.max) !== draft
          }
          onClick={() => {
            onChange(clampValue(draft, mode, props.min, props.max));
            close();
          }}
        >
          {t("Apply")}
        </Button>
      </div>
    </>
  );
}

export function SinglePicker({ mode = "datetime", ...props }: DateTimeFieldProps) {
  const format = useCalendarFormat();
  const t = useT();
  return (
    <PickerShell
      {...props}
      placeholder={
        props.placeholder ??
        (mode === "time"
          ? t("Choose a time")
          : mode === "date"
            ? t("Choose a date")
            : t("Choose date and time"))
      }
      timeOnly={mode === "time"}
      shown={formatValue(props.value, mode, format.date)}
      rawValue={props.value}
      onClear={() => props.onChange("")}
    >
      {(close, clear) => <SingleEditor clear={clear} {...props} mode={mode} close={close} />}
    </PickerShell>
  );
}
