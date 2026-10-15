import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { t, useLocale } from "../i18n";
import { X } from "./icons";
import styles from "./SearchInput.module.css";

type SearchInputProps = ComponentPropsWithoutRef<"input"> & {
  /** Use an inset button for a field that owns its border or sits outside a row. */
  standalone?: boolean;
  containerClassName?: string;
  clearable?: boolean;
  /** Composite fields and menu headers delegate focus presentation to their owner. */
  focusOwner?: "input" | "group" | "menu";
};

/** The bordered container owns the search field's single focus indicator. */
export const SearchInputGroup = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(
  function SearchInputGroup(props, ref) {
    return <div {...props} ref={ref} data-ui-focus-group="" />;
  },
);

/** Preserves the caller's input events, ref and keyboard navigation when cleared. */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    standalone = false,
    containerClassName,
    className,
    clearable = true,
    focusOwner = "input",
    onChange,
    ...props
  },
  ref,
) {
  useLocale();
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current!, []);
  const [uncontrolledValue, setUncontrolledValue] = useState(props.defaultValue ?? "");
  const hasValue = String(props.value ?? uncontrolledValue).length > 0;
  const canClear = clearable && hasValue && !props.disabled && !props.readOnly;
  const control = (
    <>
      <input
        {...props}
        data-ui-focus={focusOwner}
        onChange={(event) => {
          if (props.value === undefined) setUncontrolledValue(event.target.value);
          onChange?.(event);
        }}
        ref={input}
        className={[className, styles.input, standalone && styles.standaloneInput]
          .filter(Boolean)
          .join(" ")}
        data-search-filled={canClear || undefined}
      />
      {canClear ? (
        <button
          type="button"
          title={t("Clear search")}
          aria-label={t("Clear search")}
          data-search-clear
          className={styles.clear}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const node = input.current;
            if (!node) return;
            // Use the native setter so React delivers the same onChange event as typing.
            const view = node.ownerDocument.defaultView!;
            Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, "value")!.set!.call(
              node,
              "",
            );
            node.dispatchEvent(new view.Event("input", { bubbles: true }));
            node.focus();
          }}
        >
          <X size={12} strokeWidth={1.75} aria-hidden="true" />
        </button>
      ) : null}
    </>
  );
  return standalone ? (
    <span className={[styles.standalone, containerClassName].filter(Boolean).join(" ")}>
      {control}
    </span>
  ) : (
    control
  );
});
