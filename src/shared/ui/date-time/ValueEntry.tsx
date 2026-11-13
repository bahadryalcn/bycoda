import { useState } from "react";
import { useLocale, useT } from "../../i18n";
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
  const locale = useLocale();
  // A fixed sample date: only the locale's field order and separators are read from it.
  const parts = useCalendarFormat().parts(new Date(2026, 11, 31, 12), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const shown = formatEntry(value, mode, parts);
  const cleanDraft = { source: value, text: shown, invalid: false, dirty: false, locale, parts };
  const [draft, setDraft] = useState(cleanDraft);
  if (draft.source !== value || (!draft.dirty && draft.locale !== locale)) setDraft(cleanDraft);
  const commit = () => {
    const next = parseEntry(draft.text, mode, draft.parts);
    if (next !== null && isLocalDateTimeValue(next, mode)) {
      setDraft({ ...cleanDraft, text: formatEntry(next, mode, parts) });
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
        setDraft({
          ...draft,
          source: value,
          text: event.target.value,
          invalid: false,
          dirty: true,
        });
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
