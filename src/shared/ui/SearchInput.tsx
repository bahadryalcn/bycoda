import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { useT } from "../i18n";
import { FieldControl } from "./Field";
import { InlineAction } from "./ActionHost";
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
  appearance?: "bare" | "field" | "quiet";
  /** Field height: `sm` is the compact toolbar/filter height (default), `md` matches form
   *  controls and `size="md"` Buttons. The native `size` attribute keeps its meaning. */
  fieldSize?: SearchFieldSize;
};

export type SearchFieldSize = "sm" | "md";

/** The bordered container owns the search field's single focus indicator. */
export const SearchInputGroup = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<"div"> & {
    appearance?: "bare" | "field" | "quiet";
    /** Same heights as `SearchInput.fieldSize`; the group owns the frame. */
    size?: SearchFieldSize;
  }
>(function SearchInputGroup({ appearance = "bare", size, className, ...props }, ref) {
  return (
    <div
      {...props}
      ref={ref}
      data-ui-focus-group=""
      data-search-appearance={appearance}
      data-search-size={size === "md" ? "md" : undefined}
      className={[styles.group, className].filter(Boolean).join(" ")}
    />
  );
});

/** Looks like the search text but is a button that opens a search surface elsewhere.
 *  Place it inside a `SearchInputGroup`: the group frame is the single hover/focus surface. */
export const SearchInputTrigger = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button">>(
  function SearchInputTrigger({ className, type = "button", ...props }, ref) {
    return (
      <button
        {...props}
        ref={ref}
        type={type}
        data-ui-focus="group"
        className={[styles.trigger, className].filter(Boolean).join(" ")}
      />
    );
  },
);

/** Preserves the caller's input events, ref and keyboard navigation when cleared. */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    standalone = false,
    appearance = "bare",
    containerClassName,
    className,
    clearable = true,
    focusOwner,
    fieldSize,
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
  const insetClear = standalone || appearance !== "bare";
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
  const editor = (
    <input
      {...props}
      data-ui-focus={focus}
      data-search-appearance={appearance}
      data-search-size={fieldSize === "md" ? "md" : undefined}
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
  );
  const clearAction = canClear ? (
    <InlineAction
      reveal="always"
      label={t("Clear search")}
      data-search-clear=""
      className={styles.clear}
      // Keep focus and the caret in the field while the pointer presses the action.
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.preventDefault();
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
      <X aria-hidden="true" />
    </InlineAction>
  ) : null;
  const control = (
    <>
      {editor}
      {clearAction}
    </>
  );
  return insetClear ? (
    <span className={[styles.standalone, containerClassName].filter(Boolean).join(" ")}>
      <FieldControl
        size={fieldSize ?? "sm"}
        appearance={appearance === "quiet" ? "quiet" : "default"}
        endAdornment={clearAction}
      >
        {editor}
      </FieldControl>
    </span>
  ) : (
    control
  );
});
