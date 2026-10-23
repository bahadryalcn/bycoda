import { SearchInput } from "./SearchInput";
import { t, useT } from "../i18n";
import {
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ComponentPropsWithRef,
} from "react";
import { Check, ChevronDown, Search, X } from "./icons";
import { LAYER } from "../lib/layers";
import type { PopoverAlign } from "../lib/popover";
import { Popover } from "./Popover";
import { Button } from "./Button";
import { isImeComposition } from "../lib/keyboard";
import { SelectTrigger, SelectValue } from "./arc/select/select";
import { ComboboxSearch, ComboboxList, ComboboxItem } from "./arc/combobox/combobox";

export type SearchableSelectOption = {
  value: string;
  label: string;
  keywords?: string;
  description?: string;
  disabled?: boolean;
};

type SingleSelectProps = {
  multiple?: false;
  value: string;
  onChange: (value: string) => void;
};

/** Toggles options without closing; an empty selection shows the placeholder. */
type MultiSelectProps = {
  multiple: true;
  value: readonly string[];
  onChange: (value: string[]) => void;
};

type SelectionOptions = {
  /** Locale used for case folding, independently of the UI language. */
  searchLocale?: string;
  triggerProps?: Omit<
    ComponentPropsWithRef<"button">,
    "children" | "value" | "onChange" | "disabled"
  >;
  showSelectedValues?: boolean;
  loopNavigation?: boolean;
  selectionLabels?: {
    menu?: string;
    summary?: (count: number) => string;
    missing?: string;
    remove?: (label: string) => string;
    selected?: string;
    clear?: string;
    done?: string;
  };
};

export function SearchableSelect(
  props: {
    label: string;
    options: readonly SearchableSelectOption[];
    placeholder?: string;
    searchPlaceholder?: string;
    emptyLabel?: string;
    disabled?: boolean;
    layer?: number;
    variant?: "field" | "transparent" | "row" | "panel" | "pill";
    searchable?: boolean;
    align?: PopoverAlign;
  } & SelectionOptions &
    (SingleSelectProps | MultiSelectProps),
) {
  const t = useT();
  const {
    label,
    options,
    placeholder = t("Choose an option…"),
    searchPlaceholder = t("Search options…"),
    emptyLabel = t("No matching options"),
    disabled = false,
    layer,
    variant = "field",
    searchable = true,
    align = "start",
    searchLocale,
    triggerProps,
    showSelectedValues,
    selectionLabels,
    loopNavigation,
  } = props;
  return (
    <SearchableSelectMenu
      {...{
        label,
        options,
        placeholder,
        searchPlaceholder,
        emptyLabel,
        disabled,
        layer,
        variant,
        searchable,
        align,
        searchLocale,
        triggerProps,
        showSelectedValues,
        selectionLabels,
        loopNavigation,
      }}
      values={props.multiple ? props.value : [props.value]}
      multiple={!!props.multiple}
      onPick={(next) => {
        if (!props.multiple) return props.onChange(next);
        props.onChange(
          props.value.includes(next)
            ? props.value.filter((item) => item !== next)
            : [...props.value, next],
        );
      }}
      onRemove={
        props.multiple
          ? (next) => props.onChange(props.value.filter((item) => item !== next))
          : undefined
      }
      onClear={props.multiple ? () => props.onChange([]) : undefined}
    />
  );
}

function SearchableSelectMenu({
  label,
  values,
  multiple,
  options,
  onPick,
  onClear,
  placeholder = t("Choose an option…"),
  searchPlaceholder = t("Search options…"),
  emptyLabel = t("No matching options"),
  disabled = false,
  layer,
  variant = "field",
  searchable = true,
  align = "start",
  searchLocale,
  triggerProps,
  showSelectedValues,
  selectionLabels,
  loopNavigation,
  onRemove,
}: {
  label: string;
  values: readonly string[];
  multiple: boolean;
  options: readonly SearchableSelectOption[];
  onPick: (value: string) => void;
  onClear?: () => void;
  onRemove?: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  layer?: number;
  variant?: "field" | "transparent" | "row" | "panel" | "pill";
  searchable?: boolean;
  align?: PopoverAlign;
} & SelectionOptions) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [menuWidth, setMenuWidth] = useState<number>();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useImperativeHandle(triggerProps?.ref, () => trigger.current!, []);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const activeOption = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const optionLookup = useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options],
  );
  const value = values.join("\n");
  const selectedLabel =
    values.length && selectionLabels?.summary
      ? selectionLabels.summary(values.length)
      : values.length > 1
        ? t("{p0} selected", { p0: values.length })
        : (optionLookup.get(values[0])?.label ?? (values[0] || undefined));
  const normalizedQuery = query.trim().toLocaleLowerCase(searchLocale);
  const filtered = useMemo(
    () =>
      normalizedQuery
        ? options.filter((option) =>
            `${option.label}\n${option.description ?? ""}\n${option.keywords ?? ""}`
              .toLocaleLowerCase(searchLocale)
              .includes(normalizedQuery),
          )
        : [...options],
    [normalizedQuery, options, searchLocale],
  );
  const activeId = filtered[active] != null ? `${listId}-option-${active}` : undefined;
  const popoverLayer =
    layer ?? (root.current?.closest('[role="dialog"]') ? LAYER.dialogPopover : LAYER.popover);

  const close = (restoreFocus = false) => {
    setOpen(false);
    setQuery("");
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };

  const openMenu = () => {
    if (disabled || trigger.current?.matches(":disabled")) return;
    setMenuWidth(Math.max(240, root.current?.getBoundingClientRect().width ?? 0));
    setQuery("");
    setActive(
      Math.max(
        0,
        options.findIndex((option) => values.includes(option.value)),
      ),
    );
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      if (searchable) search.current?.focus({ preventScroll: true });
      else list.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return;
    setActive((index) => (filtered.length === 0 ? 0 : Math.min(index, filtered.length - 1)));
  }, [filtered.length, open]);

  useLayoutEffect(() => {
    if (!open) return;
    const container = list.current;
    const item = activeOption.current;
    if (!container || !item) return;
    const bounds = container.getBoundingClientRect();
    const row = item.getBoundingClientRect();
    if (row.top < bounds.top) container.scrollTop -= bounds.top - row.top;
    else if (row.bottom > bounds.bottom) {
      container.scrollTop += row.bottom - bounds.bottom;
    }
  }, [active, open]);

  useEffect(() => {
    if (!disabled) return;
    setOpen(false);
    setQuery("");
  }, [disabled]);

  const pick = (next: string) => {
    if (disabled || optionLookup.get(next)?.disabled) return;
    onPick(next);
    if (!multiple) close(true);
  };

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (isImeComposition(event.nativeEvent)) return;
    if ((event.key === "Home" || event.key === "End") && event.target instanceof HTMLInputElement)
      return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filtered.length > 0) {
        setActive((index) =>
          loopNavigation ? (index + 1) % filtered.length : Math.min(filtered.length - 1, index + 1),
        );
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filtered.length > 0) {
        setActive((index) =>
          loopNavigation ? (index - 1 + filtered.length) % filtered.length : Math.max(0, index - 1),
        );
      }
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActive(Math.max(0, filtered.length - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = filtered[active];
      if (!option) return;
      pick(option.value);
    }
  };

  const compact = variant === "pill" || variant === "row";
  const longMenu = searchable || options.length > 12;

  return (
    <div
      ref={root}
      className={
        variant === "pill" || variant === "row"
          ? "relative inline-flex max-w-56 shrink-0"
          : "relative min-w-0"
      }
    >
      <SelectTrigger
        {...triggerProps}
        ref={trigger}
        data-select-variant={variant}
        data-state={open ? "open" : "closed"}
        data-disabled={disabled || undefined}
        type={triggerProps?.type ?? "button"}
        disabled={disabled}
        aria-label={triggerProps?.["aria-label"] ?? `${label}: ${selectedLabel ?? placeholder}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? `${listId}-menu` : undefined}
        onClick={(event) => {
          triggerProps?.onClick?.(event);
          if (event.defaultPrevented) return;
          if (open) close();
          else openMenu();
        }}
        onKeyDown={(event) => {
          triggerProps?.onKeyDown?.(event);
          if (event.defaultPrevented || isImeComposition(event.nativeEvent)) return;
          if (open || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
          event.preventDefault();
          openMenu();
        }}
        className={[
          triggerProps?.className,
          variant === "row"
            ? "inline-flex h-[var(--ui-control-height-compact)] max-w-full items-center gap-1 rounded-md bg-(--ui-surface-raised) py-0 pr-1.5 pl-2 text-left text-[12px] focus-visible:outline-2 focus-visible:outline-accent hover:bg-(--ui-surface-hover) focus-visible:bg-(--ui-surface-hover) disabled:opacity-[var(--ui-disabled-opacity,0.5)]"
            : variant === "panel"
              ? "flex h-14 w-full items-center justify-end gap-3 rounded-xl border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) px-4 text-right text-[14px] font-medium focus-visible:outline-2 focus-visible:outline-accent hover:bg-(--ui-surface-hover) focus:border-(--ui-tone-neutral-border) focus:bg-(--ui-surface-hover) disabled:opacity-[var(--ui-disabled-opacity,0.5)] active:scale-[0.995]"
              : variant === "pill"
                ? "inline-flex h-[var(--ui-control-height-compact)] max-w-full items-center gap-1 rounded-md bg-(--ui-surface-raised) py-0 pr-1.5 pl-2 text-left text-[12px] focus-visible:outline-2 focus-visible:outline-accent hover:bg-(--ui-surface-hover) focus-visible:bg-(--ui-surface-hover) disabled:opacity-[var(--ui-disabled-opacity,0.5)]"
                : variant === "transparent"
                  ? "flex h-[var(--ui-control-height)] w-full items-center justify-between gap-2 rounded-md border border-(--ui-tone-neutral-border) bg-transparent px-2.5 text-left text-[13px] focus-visible:outline-2 focus-visible:outline-accent hover:border-(--ui-tone-neutral-border) focus:border-(--ui-focus-ring-color) disabled:opacity-[var(--ui-disabled-opacity,0.5)] active:scale-[0.99]"
                  : "flex h-[var(--ui-control-height)] w-full items-center justify-between gap-2 rounded-md border border-(--ui-tone-neutral-border) bg-background-base px-2.5 text-left text-[13px] focus-visible:outline-2 focus-visible:outline-accent hover:border-(--ui-tone-neutral-border) focus:border-(--ui-focus-ring-color) disabled:opacity-[var(--ui-disabled-opacity,0.5)] active:scale-[0.99]",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span
          className={`min-w-0 truncate ${variant === "panel" ? "flex-1 text-right" : variant === "pill" || variant === "row" ? "" : "flex-1"} ${selectedLabel ? "text-content" : "text-(--ui-text-secondary)"}`}
        >
          <SelectValue value={value} label={selectedLabel ?? placeholder} />
        </span>
        <ChevronDown
          className={`shrink-0 text-(--ui-text-secondary) motion-safe:transition-transform duration-150 ease-out ${variant === "pill" || variant === "row" ? "size-3" : "size-3.5"} ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </SelectTrigger>
      {showSelectedValues && multiple && values.length ? (
        <div className="bycoda-selection-values" aria-label={selectionLabels?.selected ?? label}>
          {values.map((value) => {
            const option = optionLookup.get(value);
            const name = option?.label ?? selectionLabels?.missing ?? value;
            return (
              <span
                key={value}
                className="bycoda-selection-value"
                title={option?.description ?? value}
              >
                <span>{name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  label={selectionLabels?.remove?.(name) ?? `${t("Remove")}: ${name}`}
                  disabled={disabled}
                  onClick={() => {
                    if (!disabled) onRemove?.(value);
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
              </span>
            );
          })}
        </div>
      ) : null}
      {open ? (
        <Popover
          id={`${listId}-menu`}
          anchor={trigger}
          side="bottom"
          align={align}
          gap={4}
          width={menuWidth}
          maxHeight={longMenu ? 240 : undefined}
          constrainHeight={longMenu}
          layer={popoverLayer}
          role="dialog"
          aria-label={selectionLabels?.menu ?? t("{p0} options", { p0: label })}
          data-dialog-popover
          onDismiss={(reason) => close(reason === "escape")}
          className="bycoda-arc bycoda-arc-menu flex flex-col overflow-hidden"
        >
          {searchable ? (
            <ComboboxSearch className="flex h-8 shrink-0 items-center gap-2 border-b border-stroke px-2.5 text-(--ui-text-secondary) focus-within:text-(--ui-text-secondary)">
              <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
              <span className="sr-only">{searchPlaceholder}</span>
              <SearchInput
                focusOwner="menu"
                ref={search}
                role="combobox"
                aria-label={searchPlaceholder}
                aria-expanded="true"
                aria-autocomplete="list"
                aria-controls={listId}
                aria-activedescendant={activeId}
                value={query}
                placeholder={searchPlaceholder}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onSearchKeyDown}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-content placeholder:text-(--ui-text-secondary)"
              />
            </ComboboxSearch>
          ) : null}
          <ComboboxList
            ref={list}
            id={listId}
            role="listbox"
            aria-label={label}
            aria-multiselectable={multiple || undefined}
            aria-activedescendant={searchable ? undefined : activeId}
            tabIndex={searchable ? undefined : 0}
            onKeyDown={searchable ? undefined : onSearchKeyDown}
            className="min-h-0 flex-1 overflow-y-auto overscroll-none p-1 focus-visible:outline-2 focus-visible:outline-accent"
          >
            {filtered.length > 0 ? (
              filtered.map((option, index) => {
                const highlighted = index === active;
                const isSelected = values.includes(option.value);
                return (
                  <ComboboxItem
                    key={option.value}
                    data-value={option.value}
                    ref={highlighted ? activeOption : undefined}
                    id={`${listId}-option-${index}`}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={isSelected}
                    aria-disabled={option.disabled || undefined}
                    disabled={disabled || option.disabled}
                    aria-describedby={
                      option.description ? `${listId}-description-${index}` : undefined
                    }
                    title={option.description}
                    data-active={highlighted || undefined}
                    data-highlighted={highlighted || undefined}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pick(option.value)}
                    className={`bycoda-arc-select-option flex w-full items-center gap-2 rounded-md px-2 text-left leading-none ${
                      option.description
                        ? "min-h-8 py-1.5 text-[13px]"
                        : compact
                          ? "h-7 text-[12px]"
                          : "h-8 text-[13px]"
                    } ${
                      highlighted
                        ? "bg-selection text-content"
                        : "text-(--ui-text-secondary) hover:bg-(--ui-surface-hover) hover:text-content"
                    }`}
                  >
                    <span className="grid size-3.5 shrink-0 place-items-center">
                      {isSelected ? <Check className="size-3" strokeWidth={2} /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{option.label}</span>
                      {option.description ? (
                        <span
                          id={`${listId}-description-${index}`}
                          className="bycoda-select-description block"
                        >
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                  </ComboboxItem>
                );
              })
            ) : (
              <p
                role="status"
                className="px-2 py-3 text-center text-[12px] text-(--ui-text-secondary)"
              >
                {emptyLabel}
              </p>
            )}
          </ComboboxList>
          {onClear && (values.length > 0 || selectionLabels?.done) ? (
            <div className="flex shrink-0 justify-end border-t border-stroke p-1">
              <Button
                variant="ghost"
                size="sm"
                onMouseDown={(event) => event.preventDefault()}
                disabled={disabled || !values.length}
                onClick={() => {
                  if (!disabled) onClear();
                }}
              >
                {selectionLabels?.clear ?? t("Clear selection")}
              </Button>
              {selectionLabels?.done ? (
                <Button variant="ghost" size="sm" onClick={() => close(true)}>
                  {selectionLabels.done}
                </Button>
              ) : null}
            </div>
          ) : null}
        </Popover>
      ) : null}
    </div>
  );
}
