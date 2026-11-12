import { useState } from "react";
import { useT } from "../../i18n";
import { TextField } from "../TextField";
import { useCalendarFormat } from "../../i18n/calendar";
import { formatEntry, isLocalDateTimeValue, parseEntry, type DateTimeMode } from "./values";

export function ValueEntry({
  value,
  mode,
  onChange,
  label,
  disabled,
  onValidityChange,
}: {
  value: string;
  mode: DateTimeMode;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  onValidityChange?: (valid: boolean) => void;
}) {
  const t = useT();
  // A fixed sample date: only the locale's field order and separators are read from it.
  const parts = useCalendarFormat().parts(new Date(2026, 11, 31, 12), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const shown = formatEntry(value, mode, parts);
  const [draft, setDraft] = useState({ source: value, text: shown, invalid: false });
  if (draft.source !== value) setDraft({ source: value, text: shown, invalid: false });
  const commit = () => {
    const next = parseEntry(draft.text, mode, parts);
    if (next !== null && isLocalDateTimeValue(next, mode)) {
      setDraft({ source: value, text: formatEntry(next, mode, parts), invalid: false });
      onChange(next);
      onValidityChange?.(true);
    } else {
      setDraft({ ...draft, invalid: true });
      onValidityChange?.(false);
    }
  };
  return (
    <TextField
      label={label}
      fieldSize="sm"
      disabled={disabled}
      value={draft.text}
      type="text"
      autoComplete="off"
      spellCheck={false}
      placeholder={
        mode === "time"
          ? t("HH:mm")
          : formatEntry(mode === "date" ? "2026-12-31" : "2026-12-31T14:30", mode, parts)
      }
      error={draft.invalid ? t("Enter a valid date or time.") : undefined}
      onChange={(event) => {
        setDraft({ source: value, text: event.target.value, invalid: false });
        onValidityChange?.(false);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        commit();
      }}
    />
  );
}
