import { useState, type ChangeEvent } from "react";

/**
 * Keeps what the user is typing in a NumberField apart from the saved value: valid drafts are
 * committed as they are typed, invalid or empty ones stay visible until blur resets them.
 */
export function useNumberDraft(saved: number, commit: (value: number) => void) {
  const [draft, setDraft] = useState<string | null>(null);
  return {
    value: draft ?? String(saved),
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      setDraft(input.value);
      if (input.validity.valid && input.value !== "") commit(input.valueAsNumber);
    },
    onBlur: () => setDraft(null),
  };
}
