import { useRef, useState } from "react";
import { NumberField } from "../../../shared/ui/NumberField";
import { isImeComposition } from "../../../shared/lib/keyboard";

/** Machine concurrency keeps partial edits local and saves a valid number on blur or Enter. */
export function TaskConcurrencyField({
  label,
  hideLabel,
  value,
  disabled,
  onSave,
}: {
  label: string;
  hideLabel?: boolean;
  value: number;
  disabled?: boolean;
  onSave: (value: number) => void | boolean | Promise<void | boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const text = draft ?? String(value);
  const count = Number(text);
  const valid = text.trim() !== "" && Number.isSafeInteger(count) && count > 0;
  const save = async () => {
    if (disabled || pending.current || !valid || draft === null || count === value) return;
    const submitted = draft;
    pending.current = true;
    setSaving(true);
    setError(undefined);
    try {
      if ((await onSave(count)) !== false)
        setDraft((current) => (current === submitted ? null : current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return (
    <NumberField
      label={label}
      hideLabel={hideLabel}
      min={1}
      step={1}
      value={text}
      disabled={disabled || saving}
      aria-invalid={!valid || undefined}
      error={error}
      onChange={(event) => {
        setDraft(event.currentTarget.value);
        setError(undefined);
      }}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !isImeComposition(event.nativeEvent)) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}
