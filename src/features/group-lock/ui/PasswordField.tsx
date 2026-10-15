import { t, useLocale } from "../../../shared/i18n";
import { useId, useState, type Ref } from "react";
import { Eye, EyeOff } from "../../../shared/ui/icons";

type Props = {
  label: string;
  ref?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  invalid?: boolean;
  /** Id of the element that explains an error. */
  describedBy?: string;
};

/**
 * A password input with a show/hide toggle. Uncontrolled on purpose: the text
 * stays in the input and is read from `ref` on submit, so it is never copied
 * into React state.
 */
export function PasswordField({ label, ref, autoFocus, invalid, describedBy }: Props) {
  useLocale();
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12px] text-content/60">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          ref={ref}
          type={shown ? "text" : "password"}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="w-full rounded-lg border border-content/15 bg-content/3 py-2 pl-3 pr-9 text-[13px] text-content outline-none focus:border-content/35 aria-invalid:border-danger/60"
        />
        <button
          type="button"
          title={shown ? t("Hide password") : t("Show password")}
          aria-label={shown ? t("Hide password") : t("Show password")}
          aria-pressed={shown}
          onClick={() => setShown((value) => !value)}
          className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-content/45 hover:bg-content/8 hover:text-content"
        >
          {shown ? (
            <EyeOff className="size-3.5" strokeWidth={1.75} />
          ) : (
            <Eye className="size-3.5" strokeWidth={1.75} />
          )}
        </button>
      </div>
    </div>
  );
}
