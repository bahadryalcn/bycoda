import {
  useEffect,
  useImperativeHandle,
  useRef,
  type ChangeEvent,
  type ComponentPropsWithoutRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { isImeComposition } from "../lib/keyboard";
import { ComboboxSearch } from "./arc/combobox/combobox";
import { SearchInput } from "./SearchInput";
import { Search, type IconComponent } from "./icons";
import styles from "./PopoverSearchHeader.module.css";

/** A list move requested from the search field. */
export type PopoverSearchMove = "next" | "previous" | "first" | "last";

export type PopoverSearchHeaderProps = Omit<
  ComponentPropsWithoutRef<"input">,
  "value" | "onChange" | "size" | "aria-label" | "role"
> & {
  /** Accessible name of the search field (also the default placeholder). */
  label: string;
  value: string;
  onValueChange: (value: string, event: ChangeEvent<HTMLInputElement>) => void;
  ref?: Ref<HTMLInputElement>;
  /** Leading glyph; `null` hides it. Defaults to Search. */
  icon?: IconComponent | null;
  /** Focus the field when the header mounts (popover open). Defaults to true. */
  autoFocus?: boolean;
  /**
   * The list this field drives. When set the field is a `combobox` with `aria-controls`; pass
   * `activeOptionId` for `aria-activedescendant`.
   */
  listId?: string;
  activeOptionId?: string;
  /** ArrowDown/ArrowUp (and Home/End when `homeEndMove`) forwarded to the list. */
  onMove?: (move: PopoverSearchMove, event: ReactKeyboardEvent<HTMLInputElement>) => void;
  /** Home/End move the list instead of the caret. Defaults to false (text editing keeps them). */
  homeEndMove?: boolean;
  /** Enter. `event.shiftKey` is available for reverse actions (find previous). */
  onSubmit?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  /** Escape. Only handled here when given; otherwise the popover's own dismissal runs. */
  onEscape?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  /** Trailing content in the header row: match count, find buttons, a close action. */
  trailing?: ReactNode;
  /** `sm` (default) is the 32px menu header; `md` the roomier list-pane header. */
  size?: "sm" | "md";
  /** Draw the bottom hairline that separates the header from the list. Defaults to true. */
  divider?: boolean;
  headerClassName?: string;
};

/**
 * The search row at the top of a popover or picker: unframed search text (the popover is the focus
 * context, so no field ring), a bottom hairline, autofocus, and keyboard forwarding to the list.
 * The caller keeps the query, filtering and active row; this owns only the header presentation and keys.
 */
export function PopoverSearchHeader({
  label,
  value,
  onValueChange,
  ref,
  icon: Icon = Search,
  autoFocus = true,
  listId,
  activeOptionId,
  onMove,
  homeEndMove = false,
  onSubmit,
  onEscape,
  trailing,
  size = "sm",
  divider = true,
  headerClassName,
  placeholder,
  onKeyDown,
  className,
  ...props
}: PopoverSearchHeaderProps) {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current!, []);
  useEffect(() => {
    if (!autoFocus) return;
    // After the popover places itself, so focusing cannot scroll the page to an unplaced node.
    const frame = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  const keyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || isImeComposition(event.nativeEvent)) return;
    const move: PopoverSearchMove | null =
      event.key === "ArrowDown"
        ? "next"
        : event.key === "ArrowUp"
          ? "previous"
          : homeEndMove && event.key === "Home"
            ? "first"
            : homeEndMove && event.key === "End"
              ? "last"
              : null;
    if (move && onMove) {
      event.preventDefault();
      onMove(move, event);
      return;
    }
    if (event.key === "Enter" && onSubmit) {
      event.preventDefault();
      onSubmit(event);
      return;
    }
    if (event.key === "Escape" && onEscape) {
      event.preventDefault();
      event.stopPropagation();
      onEscape(event);
    }
  };

  return (
    <ComboboxSearch
      className={[styles.header, headerClassName].filter(Boolean).join(" ")}
      data-size={size}
      data-divider={divider ? "" : undefined}
    >
      {Icon ? <Icon aria-hidden className={`${styles.icon} icon-sm`} strokeWidth={1.75} /> : null}
      <SearchInput
        {...props}
        ref={input}
        focusOwner="menu"
        type={props.type ?? "text"}
        role={listId ? "combobox" : undefined}
        aria-label={label}
        aria-controls={listId}
        aria-expanded={listId ? true : undefined}
        aria-autocomplete={listId ? "list" : undefined}
        aria-activedescendant={listId ? activeOptionId : undefined}
        autoComplete={props.autoComplete ?? "off"}
        spellCheck={props.spellCheck ?? false}
        placeholder={placeholder ?? label}
        value={value}
        onChange={(event) => onValueChange(event.target.value, event)}
        onKeyDown={keyDown}
        className={[styles.input, className].filter(Boolean).join(" ")}
      />
      {trailing != null ? <span className={styles.trailing}>{trailing}</span> : null}
    </ComboboxSearch>
  );
}
