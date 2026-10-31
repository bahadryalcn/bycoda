"use client";
import { Popover } from "../../Popover";
import { isImeComposition } from "../../../lib/keyboard";
import { t } from "../../../i18n";
import { SearchInput, SearchInputGroup } from "../../SearchInput";

import { animate, AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronDown, Search, X } from "../../icons";
import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ComponentPropsWithoutRef,
  InputHTMLAttributes,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./combobox.module.css";

/** Menu header search: the popover is the focus context, so it draws no field border or ring. */
export const ComboboxSearch = forwardRef<HTMLLabelElement, ComponentPropsWithoutRef<"label">>(
  function ComboboxSearch({ className, ...props }, ref) {
    return (
      <label
        {...props}
        ref={ref}
        data-menu-search=""
        className={[styles.search, className].filter(Boolean).join(" ")}
      />
    );
  },
);

export const ComboboxList = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(
  function ComboboxList({ className, ...props }, ref) {
    return (
      <div {...props} ref={ref} className={[styles.listbox, className].filter(Boolean).join(" ")} />
    );
  },
);

/** A choice row for bycoda pickers (SearchableSelect, Select). The Combobox below keeps its own `option` row. */
export const ComboboxItem = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button">>(
  function ComboboxItem({ className, ...props }, ref) {
    return (
      <button
        {...props}
        ref={ref}
        className={[styles.choice, className].filter(Boolean).join(" ")}
      />
    );
  },
);

/** Content of a choice row: check slot, optional icon, truncating label and an optional description beneath it. */
export function ComboboxChoice({
  label,
  description,
  descriptionId,
  title,
}: {
  selected: boolean;
  icon?: ReactNode;
  label: ReactNode;
  description?: string;
  descriptionId?: string;
  /** Full text for a label that may truncate. */
  title?: string;
}) {
  return (
    <>
      <span className={styles.choiceBody} title={title}>
        <span className={`${styles.choiceLabel} truncate`}>{label}</span>
        {description ? (
          <span
            id={descriptionId}
            className={`${styles.choiceDescription} bycoda-select-description`}
          >
            {description}
          </span>
        ) : null}
      </span>
    </>
  );
}

/** Loading, failure or empty copy for a picker, with an optional recovery action. Failure is announced as an alert. */
export function ComboboxStatus({
  tone = "neutral",
  empty = false,
  children,
  action,
  className,
}: {
  tone?: "neutral" | "danger";
  /** Centered copy for a list with nothing to show. */
  empty?: boolean;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      data-tone={tone === "danger" ? "danger" : undefined}
      className={[styles.status, empty && styles.statusEmpty, className].filter(Boolean).join(" ")}
    >
      <span className={styles.statusText}>{children}</span>
      {action}
    </div>
  );
}

export interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
  keywords?: string[];
}

export interface ComboboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange" | "placeholder"
> {
  label: string;
  hideLabel?: boolean;
  /** Accept an editable value outside the suggestions on Enter or blur. */
  allowCustomValue?: boolean;
  options: ComboboxOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  description?: string;
  placeholder?: string;
  emptyMessage?: string;
  className?: string;
}

/** Animate the layout projection instead of measuring and tweening every list height. */
function AutoHeight({
  children,
  reduceMotion,
}: {
  children: ReactNode;
  reduceMotion: boolean | null;
}) {
  return (
    <motion.div
      className={styles.autoHeight}
      initial={false}
      layout={reduceMotion ? false : "size"}
      transition={reduceMotion ? { duration: 0 } : motionTokens.spring.smooth}
    >
      <motion.div layout={reduceMotion ? false : "position"}>{children}</motion.div>
    </motion.div>
  );
}

export const Combobox = forwardRef<HTMLInputElement, ComboboxProps>(function Combobox(
  {
    label,
    hideLabel = false,
    allowCustomValue = false,
    options,
    value: controlledValue,
    defaultValue = "",
    onValueChange,
    description,
    placeholder = "Search or select…",
    emptyMessage = "No matches found",
    id,
    className,
    disabled,
    onFocus,
    onBlur,
    onKeyDown,
    ...inputProps
  },
  forwardedRef,
) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const listboxId = `${controlId}-listbox`;
  const hintId = description ? `${controlId}-description` : undefined;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const reduceMotion = useReducedMotion();
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const draftDirty = useRef(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const selectedValue = controlledValue ?? uncontrolledValue;
  const selectedOption = options.find((option) => option.value === selectedValue);

  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

  // A chosen label settles into the field: it rises in from below with a soft blur. Clearing fades the
  // placeholder in instead of snapping from the old label.
  const settledValue = useRef(selectedValue);
  useEffect(() => {
    if (settledValue.current === selectedValue) return;
    settledValue.current = selectedValue;
    const input = inputRef.current;
    if (!input || reduceMotion || (selectedValue && open)) return;
    const controls = selectedValue
      ? animate(
          input,
          {
            opacity: [0, 1],
            y: ["0.35em", "0em"],
          },
          { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] },
        )
      : animate(
          input,
          { opacity: [0, 1] },
          { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.enter] },
        );
    return () => controls.complete();
  }, [selectedValue, reduceMotion, open]);

  const matchingOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((option) =>
      [option.label, ...(option.keywords ?? [])].some((term) =>
        term.toLocaleLowerCase().includes(normalizedQuery),
      ),
    );
  }, [options, query]);

  const customValue = query.trim();
  const exactOption = options.find((option) =>
    [option.value, option.label].some((text) => text.toLocaleLowerCase() === customValue.toLocaleLowerCase()),
  );
  const filteredOptions = allowCustomValue && customValue && !exactOption
    ? [...matchingOptions, { value: customValue, label: t("Use “{p0}”", { p0: customValue }) }]
    : matchingOptions;

  const enabledIndices = filteredOptions.reduce<number[]>((indices, option, index) => {
    if (!option.disabled) indices.push(index);
    return indices;
  }, []);

  useEffect(() => {
    if (!open) return;
    const activeOption = activeIndex >= 0 ? filteredOptions[activeIndex] : undefined;
    const option = activeOption ? optionRefs.current[activeOption.value] : null;
    const listbox = option?.parentElement;
    if (option && listbox) {
      const top = option.offsetTop;
      const bottom = top + option.offsetHeight;
      if (top < listbox.scrollTop) listbox.scrollTop = top;
      else if (bottom > listbox.scrollTop + listbox.clientHeight)
        listbox.scrollTop = bottom - listbox.clientHeight;
    }
  }, [activeIndex, filteredOptions, open]);

  useEffect(() => {
    if (allowCustomValue) return; // The app Popover owns dismissal in editable mode.
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [allowCustomValue]);

  const choose = (option: ComboboxOption) => {
    if (option.disabled || (allowCustomValue && (disabled || inputProps.readOnly))) return;
    draftDirty.current = false;
    setUncontrolledValue(option.value);
    onValueChange?.(option.value);
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  };

  const commitDraft = () => {
    if (!allowCustomValue || !draftDirty.current || disabled || inputProps.readOnly) return;
    draftDirty.current = false;
    if (exactOption?.disabled) return;
    const nextValue = exactOption?.value ?? customValue;
    if (nextValue !== selectedValue) {
      setUncontrolledValue(nextValue);
      onValueChange?.(nextValue);
    }
  };

  const dismiss = (reason: "outside" | "escape") => {
    if (reason === "outside") commitDraft();
    draftDirty.current = false;
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
  };

  const clear = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    draftDirty.current = false;
    setUncontrolledValue("");
    onValueChange?.("");
    setQuery("");
    setOpen(true);
    inputRef.current?.focus();
  };

  const openMenu = () => {
    if (disabled || (allowCustomValue && (open || inputProps.readOnly))) return;
    setOpen(true);
    setQuery(allowCustomValue ? (selectedOption?.label ?? selectedValue) : "");
    setActiveIndex(-1);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (allowCustomValue) {
      onKeyDown?.(event);
      if (event.defaultPrevented || inputProps.readOnly || isImeComposition(event.nativeEvent)) return;
    }
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      if (!enabledIndices.length) return;
      const currentPosition = enabledIndices.indexOf(activeIndex);
      const nextPosition =
        allowCustomValue && currentPosition < 0
          ? (event.key === "ArrowDown" ? 0 : enabledIndices.length - 1)
          : event.key === "ArrowDown"
          ? (currentPosition + 1) % enabledIndices.length
          : (currentPosition - 1 + enabledIndices.length) % enabledIndices.length;
      setActiveIndex(enabledIndices[nextPosition]!);
      return;
    }
    if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      const option = filteredOptions[activeIndex];
      if (option) choose(option);
      return;
    }
    if (allowCustomValue && event.key === "Enter" && open) {
      event.preventDefault();
      commitDraft();
      dismiss("escape");
      return;
    }
    if (allowCustomValue && event.key === "Tab" && open) {
      dismiss("outside");
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      if (allowCustomValue) {
        event.stopPropagation();
        dismiss("escape");
      } else {
        setOpen(false);
        setQuery("");
      }
      return;
    }
  };

  const inputValue = open ? query : (selectedOption?.label ?? (allowCustomValue ? selectedValue : ""));
  const activeOption = activeIndex >= 0 ? filteredOptions[activeIndex] : undefined;

  const menu = (
    <AutoHeight reduceMotion={reduceMotion}>
      <div
        id={listboxId}
        className={styles.listbox}
        role="listbox"
        aria-label={allowCustomValue ? t("{p0} options", { p0: label }) : `${label} options`}
      >
        {filteredOptions.length ? (
          filteredOptions.map((option, index) => (
            <div
              key={option.value}
              ref={(element) => {
                optionRefs.current[option.value] = element;
              }}
              id={`${controlId}-option-${allowCustomValue ? index : option.value}`}
              className={styles.option}
              data-active={index === activeIndex ? "true" : undefined}
              data-disabled={option.disabled ? "true" : undefined}
              role="option"
              aria-selected={option.value === selectedValue}
              aria-disabled={option.disabled || undefined}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => !option.disabled && setActiveIndex(index)}
              onClick={() => choose(option)}
            >
              <span>{option.label}</span>
              {option.value === selectedValue && (
                <Check
                  className={styles.check}
                  size={16}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              )}
            </div>
          ))
        ) : (
          <motion.div
            className={styles.empty}
            role="status"
            initial={reduceMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: motionTokens.duration.standard,
              ease: [...motionTokens.ease.enter],
            }}
          >
            {emptyMessage}
          </motion.div>
        )}
      </div>
    </AutoHeight>
  );

  return (
    <div ref={rootRef} className={styles.field}>
      <label htmlFor={controlId} className={hideLabel ? "sr-only" : undefined}>{label}</label>
      <SearchInputGroup
        className={[
          styles.control,
          open ? styles.open : "",
          disabled ? styles.disabled : "",
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <Search className={styles.searchIcon} size={16} strokeWidth={1.75} aria-hidden="true" />
        <SearchInput
          {...inputProps}
          focusOwner="group"
          clearable={open}
          ref={inputRef}
          id={controlId}
          type="text"
          role="combobox"
          value={inputValue}
          // While searching, the chosen label stays in place as muted placeholder copy instead of vanishing.
          placeholder={selectedOption?.label ?? placeholder}
          disabled={disabled}
          aria-describedby={[hintId, inputProps["aria-describedby"]].filter(Boolean).join(" ") || undefined}
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            open && activeOption ? `${controlId}-option-${allowCustomValue ? activeIndex : activeOption.value}` : undefined
          }
          onFocus={(event) => {
            onFocus?.(event);
            if (!allowCustomValue || !event.defaultPrevented) openMenu();
          }}
          onBlur={(event) => {
            if (allowCustomValue) dismiss("outside");
            onBlur?.(event);
          }}
          onClick={openMenu}
          onChange={(event) => {
            if (allowCustomValue) draftDirty.current = true;
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={handleKeyDown}
        />
        <AnimatePresence initial={false}>
          {(selectedOption || (allowCustomValue && selectedValue)) && !disabled && (!allowCustomValue || !inputProps.readOnly) && (!open || !query) && (
            <motion.button
              type="button"
              className={styles.clear}
              aria-label={allowCustomValue ? t("Clear selection") : "Clear selection"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={clear}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
              animate={{
                opacity: 1,
                scale: 1,
                transition: reduceMotion
                  ? { duration: motionTokens.duration.instant }
                  : {
                      ...motionTokens.spring.snappy,
                      opacity: { duration: motionTokens.duration.fast },
                    },
              }}
              exit={{
                opacity: 0,
                ...(reduceMotion ? {} : { scale: 0.6 }),
                transition: {
                  duration: motionTokens.duration.instant,
                  ease: [...motionTokens.ease.standard],
                },
              }}
              whileTap={{
                scale: reduceMotion ? 1 : 0.96,
                transition: {
                  duration: motionTokens.duration.instant,
                  ease: [...motionTokens.ease.standard],
                },
              }}
            >
              <X size={16} strokeWidth={1.75} aria-hidden="true" />
            </motion.button>
          )}
        </AnimatePresence>
        <ChevronDown className={styles.chevron} size={16} strokeWidth={1.75} aria-hidden="true" />
      </SearchInputGroup>
      {description && (
        <span id={hintId} className={styles.hint}>
          {description}
        </span>
      )}
      <AnimatePresence initial={false}>
        {open && (allowCustomValue ? (
          <Popover
            anchor={rootRef}
            align="start"
            ignore={`[id="${controlId}"]`}
            maxHeight={240}
            restoreFocus={false}
            onDismiss={dismiss}
            className="bycoda-arc"
          >
            {menu}
          </Popover>
        ) : (
          <motion.div
            className={styles.popover}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              transition: reduceMotion
                ? { duration: motionTokens.duration.instant }
                : {
                    ...motionTokens.spring.snappy,
                    opacity: {
                      duration: motionTokens.duration.fast,
                      ease: [...motionTokens.ease.enter],
                    },
                  },
            }}
            exit={{
              opacity: 0,
              ...(reduceMotion ? {} : { y: -4, scale: 0.98 }),
              transition: {
                duration: motionTokens.duration.instant,
                ease: [...motionTokens.ease.standard],
              },
            }}
            role="presentation"
          >
            {menu}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
});

Combobox.displayName = "Combobox";
