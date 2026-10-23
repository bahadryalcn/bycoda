import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { useT } from "../i18n";
import { X } from "./icons";
import styles from "./SearchInput.module.css";

type SearchInputProps = ComponentPropsWithoutRef<"input"> & {
  /** Use an inset button for a field that owns its border or sits outside a row. */
  standalone?: boolean;
  containerClassName?: string;
  clearable?: boolean;
  /** Composite fields and menu headers delegate focus presentation to their owner.
   *  Defaults to the input only when it draws its own frame (`field` or `standalone`). */
  focusOwner?: "input" | "group" | "menu";
  /** A bordered common field, or an unframed input inside a composite/menu owner. */
  appearance?: "bare" | "field";
};

/** The bordered container owns the search field's single focus indicator. */
export const SearchInputGroup = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<"div"> & { appearance?: "bare" | "field" }
>(function SearchInputGroup({ appearance = "bare", className, ...props }, ref) {
  return (
    <div
      {...props}
      ref={ref}
      data-ui-focus-group=""
      data-search-appearance={appearance}
      className={[styles.group, className].filter(Boolean).join(" ")}
    />
  );
});

/** Preserves the caller's input events, ref and keyboard navigation when cleared. */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    standalone = false,
    appearance = "bare",
    containerClassName,
    className,
    clearable = true,
    focusOwner,
    onChange,
    ...props
  },
  ref,
) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current!, []);
  const [uncontrolledValue, setUncontrolledValue] = useState(props.defaultValue ?? "");
  const hasValue = String(props.value ?? uncontrolledValue).length > 0;
  const canClear = clearable && hasValue && !props.disabled && !props.readOnly;
  const insetClear = standalone || appearance === "field";
  // An unframed input lives inside a header, row or menu; a ring around the bare
  // text box would draw a second rectangle inside that owner.
  const focus = focusOwner ?? (insetClear ? "input" : "menu");
  useEffect(() => {
    if (props.value !== undefined) return;
    const node = input.current;
    const form = node?.form;
    if (!node || !form) return;
    let timer: number | undefined;
    const reset = (event: Event) => {
      window.clearTimeout(timer);
      // Reset listeners precede the native default action. Read its result afterwards.
      timer = window.setTimeout(() => {
        if (!event.defaultPrevented && node.isConnected) setUncontrolledValue(node.value);
      }, 0);
    };
    form.addEventListener("reset", reset);
    return () => {
      form.removeEventListener("reset", reset);
      window.clearTimeout(timer);
    };
  }, [props.value, props.form]);
  const control = (
    <>
      <input
        {...props}
        data-ui-focus={focus}
        data-search-appearance={appearance}
        onChange={(event) => {
          if (props.value === undefined) setUncontrolledValue(event.target.value);
          onChange?.(event);
        }}
        ref={input}
        className={[className, styles.input, insetClear && styles.standaloneInput]
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
  return insetClear ? (
    <span className={[styles.standalone, containerClassName].filter(Boolean).join(" ")}>
      {control}
    </span>
  ) : (
    control
  );
});
