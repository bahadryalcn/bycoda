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
import { optionalTextAttributes, type TextRoles } from "./Text";
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
  /** Size of the typed text: `secondary` 13px, `body` 14px, ...; unset keeps the field's own size. */
  textSize?: TextRoles["size"];
  /** Line height of the typed text; unset keeps the field's own. */
  leading?: TextRoles["leading"];
};

export type SearchFieldSize = "sm" | "md";

/**
 * Bordered frame around a search input and its adornments; it owns the single hover and focus indicator.
 * `appearance`: `bare` (default), `field` (standalone form look), `quiet` (navigation search).
 * @group fields
 * @use Compose SearchInput with buttons or filters inside one frame.
 * @avoid A plain search box needs only SearchInput.
 */
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

/**
 * Single-line search field with a clear button; clearing fires a real change event and keeps focus in the field.
 * `fieldSize` sm (default, toolbar height) or md (form height); `textSize` and `leading` set the type role of the typed text. Native input events, ref and keys pass through.
 * @group fields
 * @use Filter or search a list, tree or table; standalone or inside a SearchInputGroup.
 * @avoid Choosing from a long option list: SearchableSelect. General text entry: Input. A plain text field without search behavior: TextField.
 */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    standalone = false,
    appearance = "bare",
    containerClassName,
    className,
    clearable = true,
    focusOwner,
    fieldSize,
    textSize,
    leading,
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
      {...optionalTextAttributes(
        { size: textSize, leading },
        [className, styles.input, insetClear && styles.standaloneInput].filter(Boolean).join(" "),
      )}
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
