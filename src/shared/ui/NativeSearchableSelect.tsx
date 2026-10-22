import {
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ComponentPropsWithRef,
} from "react";
import { SearchableSelect } from "./SearchableSelect";
import styles from "./NativeSearchableSelect.module.css";

type SearchProps = ComponentProps<typeof SearchableSelect>;

export type NativeSearchableSelectProps = Omit<
  ComponentPropsWithRef<"select">,
  "children" | "multiple" | "size" | "value" | "defaultValue"
> &
  Pick<
    SearchProps,
    | "label"
    | "options"
    | "triggerProps"
    | "placeholder"
    | "searchPlaceholder"
    | "emptyLabel"
    | "searchLocale"
    | "variant"
    | "layer"
    | "align"
  > & {
    value?: string;
    defaultValue?: string;
  };

/** Searchable presentation with a real select owning native form semantics. */
export function NativeSearchableSelect({
  label,
  options,
  triggerProps,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  searchLocale,
  variant,
  layer,
  align,
  ref,
  className,
  onChange,
  onFocus,
  onInvalid,
  ...nativeProps
}: NativeSearchableSelectProps) {
  const select = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [selection, setSelection] = useState(nativeProps.value ?? nativeProps.defaultValue ?? "");
  const [error, setError] = useState("");
  const errorId = useId();
  useImperativeHandle(ref, () => select.current!, []);
  useImperativeHandle(triggerProps?.ref, () => trigger.current!, []);

  // Read native normalization too: missing values and disabled first options are
  // resolved by the browser rather than by a second selection implementation.
  useLayoutEffect(() => {
    if (select.current) {
      setSelection(select.current.value);
      if (select.current.validity.valid) setError("");
    }
  }, [nativeProps.value, nativeProps.defaultValue, options]);

  useEffect(() => {
    const node = select.current;
    const form = node?.form;
    if (!node || !form) return;
    const pending = new Set<ReturnType<typeof setTimeout>>();
    const reset = (event: Event) => {
      // The reset event precedes the browser default action and may be cancelled.
      // A microtask can run at the event listener checkpoint before reset's
      // default action in real browsers. Read in the following task instead.
      const timer = setTimeout(() => {
        pending.delete(timer);
        if (event.defaultPrevented || !node.isConnected) return;
        if (nativeProps.value !== undefined) node.value = nativeProps.value;
        setSelection(node.value);
        setError("");
      }, 0);
      pending.add(timer);
    };
    form.addEventListener("reset", reset);
    return () => {
      form.removeEventListener("reset", reset);
      pending.forEach(clearTimeout);
    };
  }, [nativeProps.form, nativeProps.value]);

  return (
    <div className={[styles.root, className].filter(Boolean).join(" ")}>
      <select
        {...nativeProps}
        ref={select}
        className={styles.native}
        tabIndex={-1}
        aria-hidden="true"
        onFocus={(event) => {
          onFocus?.(event);
          trigger.current?.focus();
        }}
        onInvalid={(event) => {
          onInvalid?.(event);
          if (event.defaultPrevented) return;
          // Native browser validation still blocks submission. Its invisible
          // tooltip/focus is replaced with focus on the operable shared trigger.
          event.preventDefault();
          setError(event.currentTarget.validationMessage);
          const firstInvalid = Array.from(event.currentTarget.form?.elements ?? []).find(
            (element) =>
              "willValidate" in element &&
              (element as HTMLSelectElement).willValidate &&
              !(element as HTMLSelectElement).validity.valid,
          );
          if (!firstInvalid || firstInvalid === event.currentTarget) trigger.current?.focus();
        }}
        onChange={(event) => {
          setSelection(event.currentTarget.value);
          onChange?.(event);
          setError(event.currentTarget.validity.valid ? "" : event.currentTarget.validationMessage);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <SearchableSelect
        {...{
          label,
          options,
          placeholder,
          searchPlaceholder,
          emptyLabel,
          searchLocale,
          variant,
          layer,
          align,
        }}
        value={selection}
        disabled={nativeProps.disabled}
        triggerProps={{
          id: nativeProps.id ? `${nativeProps.id}-trigger` : undefined,
          "aria-label": nativeProps["aria-label"],
          "aria-labelledby": nativeProps["aria-labelledby"],
          "aria-required": nativeProps.required,
          "aria-invalid": nativeProps["aria-invalid"] ?? (!!error || undefined),
          ...triggerProps,
          "aria-describedby":
            [
              triggerProps?.["aria-describedby"] ?? nativeProps["aria-describedby"],
              error ? errorId : undefined,
            ]
              .filter(Boolean)
              .join(" ") || undefined,
          ref: trigger,
        }}
        onChange={(next) => {
          const node = select.current;
          if (!node || node.matches(":disabled")) return;
          node.value = next;
          node.dispatchEvent(new Event("input", { bubbles: true }));
          node.dispatchEvent(new Event("change", { bubbles: true }));
          setSelection(node.value);
        }}
      />
      {error ? (
        <span id={errorId} role="alert" className={styles.error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
