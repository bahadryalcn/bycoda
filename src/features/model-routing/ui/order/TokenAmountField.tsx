import { useEffect, useState, type KeyboardEvent } from "react";
import { useFormat, useT } from "../../../../shared/i18n";
import { Combobox } from "../../../../shared/ui/Combobox";
import { InlineError } from "../../../../shared/ui/InlineError";
import {
  TOKEN_LADDER,
  formatTokenAmount,
  parseTokenAmount,
  shortTokenLabel,
  stepTokenAmount,
  type TokenAmountParse,
} from "../../model/tokenAmount";

export type TokenAmountFieldProps = {
  label: string;
  hideLabel?: boolean;
  /** Canonical digits, or "" for no limit. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Reports whether the field shows an error, and false once it unmounts, so Save can wait for a fix. */
  onInvalidChange?: (invalid: boolean) => void;
};

type TokenAmountError = Extract<TokenAmountParse, { ok: false }>["reason"];

/**
 * Token limit with free entry and preset suggestions. Typing keeps the user's text; blur, Enter or
 * a pick parses it and shows the formatted number. ArrowUp/ArrowDown step the preset ladder while
 * the suggestion list is closed and commit at once. Invalid text is shown with an error, never
 * sent to onChange, and reported through onInvalidChange.
 */
export function TokenAmountField({
  label,
  hideLabel = false,
  value,
  onChange,
  disabled,
  onInvalidChange,
}: TokenAmountFieldProps) {
  const t = useT();
  const { locale } = useFormat();
  const [text, setText] = useState(() => (value ? formatTokenAmount(Number(value), locale) : ""));
  const [synced, setSynced] = useState(value);
  const [error, setError] = useState<TokenAmountError | null>(null);

  // Adopt a value changed by the parent; comparing with the last prop avoids an effect.
  if (value !== synced) {
    setSynced(value);
    setText(value ? formatTokenAmount(Number(value), locale) : "");
    setError(null);
  }

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Tells the editor this field holds an unfixed value; onInvalidChange only sets state by key, so a stale closure is harmless.
  useEffect(() => {
    onInvalidChange?.(error !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Re-report only when the error changes, not when the parent re-renders.
  }, [error]);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Clears the report when the field unmounts (for example a tab change) so a gone field cannot block Save.
  useEffect(() => () => onInvalidChange?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps -- Unmount-only cleanup.

  const apply = (amount: number | null) => {
    setError(null);
    setText(amount === null ? "" : formatTokenAmount(amount, locale));
    onChange(amount === null ? "" : String(amount));
  };

  const onValueChange = (next: string) => {
    const parsed = parseTokenAmount(next, locale);
    if (parsed.ok) {
      apply(parsed.value);
      return;
    }
    setText(next);
    setError(parsed.reason);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    // Combobox opens its list on ArrowDown/ArrowUp while closed; only a closed list steps the ladder.
    if (event.currentTarget.getAttribute("aria-expanded") === "true") return;
    const current = parseTokenAmount(text, locale);
    if (!current.ok) return;
    event.preventDefault();
    apply(stepTokenAmount(current.value, event.key === "ArrowUp" ? 1 : -1));
  };

  const errorText =
    error === "decimal"
      ? t("Enter a whole number.")
      : error === "negative"
        ? t("Enter a positive number.")
        : error
          ? t("Enter a number like 500K or 5M.")
          : null;

  const options = TOKEN_LADDER.map((amount) => ({
    value: String(amount),
    label: shortTokenLabel(amount, locale),
    keywords: [String(amount), formatTokenAmount(amount, locale)],
  }));

  return (
    <div className="flex min-w-24 flex-col gap-1">
      <Combobox
        label={label}
        hideLabel={hideLabel}
        allowCustomValue
        options={options}
        value={text}
        onValueChange={onValueChange}
        onKeyDown={onKeyDown}
        placeholder={t("No limit")}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
      />
      {errorText ? <InlineError>{errorText}</InlineError> : null}
    </div>
  );
}
