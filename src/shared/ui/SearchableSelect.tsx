import { SearchInput } from "./SearchInput";
import { t, useT } from "../i18n";
import {
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ComponentPropsWithRef,
  type ReactNode,
  type RefObject,
} from "react";
import { ChevronDown, Search, X } from "./icons";
import { Spinner } from "./Spinner";
import { Field, fieldDescribedBy, type FieldVariant } from "./Field";
import { MatchText, matchPositions } from "./MatchText";
import styles from "./SearchableSelect.module.css";
import { LAYER } from "../lib/layers";
import type { PopoverAlign } from "../lib/popover";
import { Popover } from "./Popover";
import { InlineAction } from "./ActionHost";
import { Button } from "./Button";
import { isImeComposition } from "../lib/keyboard";
import { SelectTrigger, SelectValue } from "./arc/select/select";
import {
  ComboboxChoice,
  ComboboxItem,
  ComboboxList,
  ComboboxSearch,
  ComboboxStatus,
} from "./arc/combobox/combobox";

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

/**
 * Presentation of options that a caller loads. The caller owns fetching, cancellation and retry; the picker keeps the
 * committed value and any stale options visible and only distinguishes the four situations: loading, failed, empty and
 * filtered-empty.
 */
type AsyncOptions = {
  /** Options are being loaded or refreshed. The trigger stays enabled and shows the committed value. */
  loading?: boolean;
  loadingLabel?: string;
  /** Loading failed. Announced as an alert beside the list; existing options remain choosable. */
  error?: ReactNode;
  /** Shows a Retry action with the error. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Shown when there are no options at all and no query. Defaults to `emptyLabel`. */
  noOptionsLabel?: string;
};

/**
 * Optional shared Field composition (visible label, help, validation message). Without any of these props the picker
 * renders exactly as before. `fieldError` is the validation message; the async-load `error` stays inside the list.
 */
type FieldOptions = {
  /** Show `label` above the trigger in the shared field composition (implied by description/fieldError). */
  visibleLabel?: boolean;
  description?: string;
  fieldError?: string;
  fieldVariant?: FieldVariant;
};

type SelectionOptions = AsyncOptions & FieldOptions & {
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
    loading,
    loadingLabel,
    error,
    onRetry,
    retryLabel,
    noOptionsLabel,
    visibleLabel,
    description,
    fieldError,
    fieldVariant,
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
        loading,
        loadingLabel,
        error,
        onRetry,
        retryLabel,
        noOptionsLabel,
        visibleLabel,
        description,
        fieldError,
        fieldVariant,
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

/**
 * One option row. Memoised so a keyboard move re-renders the two rows whose state changed rather than the whole list,
 * which is what keeps arrow navigation responsive in lists with hundreds of options.
 */
const OptionRow = memo(function OptionRow({
  option,
  index,
  listId,
  highlighted,
  selected,
  compact,
  query,
  rowRef,
  controlDisabled,
  onPick,
  onHover,
}: {
  option: SearchableSelectOption;
  index: number;
  listId: string;
  highlighted: boolean;
  selected: boolean;
  compact: boolean;
  /** The raw query when one is active, to accent matched text. */
  query: string;
  rowRef?: RefObject<HTMLButtonElement | null>;
  controlDisabled: boolean;
  onPick: (value: string) => void;
  onHover: (index: number) => void;
}) {
  const title = option.description ? `${option.label} - ${option.description}` : option.label;
  return (
    <ComboboxItem
      data-value={option.value}
      ref={rowRef}
      id={`${listId}-option-${index}`}
      type="button"
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      aria-disabled={option.disabled || undefined}
      disabled={controlDisabled || option.disabled}
      aria-describedby={option.description ? `${listId}-description-${index}` : undefined}
      data-active={highlighted || undefined}
      data-highlighted={highlighted || undefined}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={() => {
        if (!option.disabled) onHover(index);
      }}
      onClick={() => onPick(option.value)}
      className={`bycoda-arc-select-option ${
        option.description ? "min-h-8 py-1.5" : compact ? "h-7" : "h-8"
      }`}
    >
      <ComboboxChoice
        selected={selected}
        label={
          <MatchText
            text={option.label}
            positions={matchPositions(option.label, query)}
            active={query.trim().length > 0}
          />
        }
        description={option.description}
        descriptionId={`${listId}-description-${index}`}
        title={title}
      />
    </ComboboxItem>
  );
});

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
  loading = false,
  loadingLabel,
  error,
  onRetry,
  retryLabel,
  noOptionsLabel,
  visibleLabel = false,
  description,
  fieldError,
  fieldVariant = "form",
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
  // A disabled picker cannot stay open: close during render so re-enabling does not reopen it.
  if (disabled && (open || query)) {
    setOpen(false);
    setQuery("");
  }
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useImperativeHandle(triggerProps?.ref, () => trigger.current!, []);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const activeOption = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const generatedTriggerId = useId();
  const triggerId = triggerProps?.id ?? generatedTriggerId;
  const composed = visibleLabel || Boolean(description) || Boolean(fieldError);
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
  // Disabled options are shown but never active: the stored index falls through to the first choosable row.
  const firstChoosable = filtered.findIndex((option) => !option.disabled);
  const activeIndex = filtered[active] && !filtered[active]!.disabled ? active : firstChoosable;
  const activeId = activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined;
  const failed = error != null && error !== false && error !== "";
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
    const committed = options.findIndex(
      (option) => values.includes(option.value) && !option.disabled,
    );
    setActive(
      committed >= 0
        ? committed
        : Math.max(
            0,
            options.findIndex((o) => !o.disabled),
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
  }, [activeIndex, open]);

  const pick = (next: string) => {
    if (disabled || optionLookup.get(next)?.disabled) return;
    onPick(next);
    if (!multiple) close(true);
  };

  // Rows are memoised, so they call the latest pick through a stable handler.
  const latestPick = useRef(pick);
  useLayoutEffect(() => {
    latestPick.current = pick;
  });
  const pickLatest = useCallback((next: string) => latestPick.current(next), []);

  /** Next choosable row from `from`; wraps only with loopNavigation, otherwise stays at the end. */
  const step = (from: number, direction: 1 | -1) => {
    const count = filtered.length;
    for (let offset = 1; offset <= count; offset++) {
      const raw = from + direction * offset;
      const index = loopNavigation ? ((raw % count) + count) % count : raw;
      if (index < 0 || index >= count) return from;
      if (!filtered[index]!.disabled) return index;
    }
    return from;
  };

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (isImeComposition(event.nativeEvent)) return;
    if ((event.key === "Home" || event.key === "End") && event.target instanceof HTMLInputElement)
      return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filtered.length > 0) setActive(step(activeIndex, 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filtered.length > 0) setActive(step(activeIndex, -1));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActive(Math.max(0, firstChoosable));
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      let last = filtered.length - 1;
      while (last > 0 && filtered[last]!.disabled) last--;
      setActive(Math.max(0, last));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = filtered[activeIndex];
      if (!option) return;
      pick(option.value);
    }
  };

  const compact = variant === "pill" || variant === "row";
  const framed = variant === "field" || variant === "transparent";
  const longMenu = searchable || options.length > 12;
  const showLoading = loading && !failed;
  // A list with nothing to show says why: loading and failure have their own rows, an empty source and a filtered-out
  // query keep different copy, and an unfinished or failed load is never presented as "no matches".
  const noResults = !loading && !failed && filtered.length === 0;
  const resultsCopy =
    options.length === 0 && !normalizedQuery ? (noOptionsLabel ?? emptyLabel) : emptyLabel;

  const picker = (
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
        id={composed ? triggerId : triggerProps?.id}
        ref={trigger}
        aria-invalid={fieldError ? true : triggerProps?.["aria-invalid"]}
        aria-describedby={
          composed
            ? fieldDescribedBy(
                triggerId,
                { description, error: fieldError },
                triggerProps?.["aria-describedby"],
              )
            : triggerProps?.["aria-describedby"]
        }
        data-select-variant={variant}
        data-state={open ? "open" : "closed"}
        data-disabled={disabled || undefined}
        data-loading={loading || undefined}
        type={triggerProps?.type ?? "button"}
        disabled={disabled}
        aria-label={triggerProps?.["aria-label"] ?? `${label}: ${selectedLabel ?? placeholder}`}
        aria-busy={loading || triggerProps?.["aria-busy"]}
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
          // Field and transparent triggers share the Select frame (border, surface, height, hover, focus, invalid and
          // disabled roles); the compact variants are deliberate toolbar shapes with their own utilities.
          framed
            ? `bycoda-arc-select text-left ${variant === "transparent" ? "bg-transparent" : ""}`
            : variant === "row"
              ? "inline-flex h-[var(--ui-control-height-compact)] max-w-full items-center gap-1 rounded-md bg-(--ui-surface-raised) py-0 pr-1.5 pl-2 text-left text-[12px] focus-visible:outline-2 focus-visible:outline-accent hover:bg-(--ui-surface-hover) focus-visible:bg-(--ui-surface-hover) disabled:opacity-[var(--ui-disabled-opacity,0.5)]"
              : variant === "panel"
                ? "flex h-14 w-full items-center justify-end gap-3 rounded-xl border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) px-4 text-right text-[14px] font-medium focus-visible:outline-2 focus-visible:outline-accent hover:bg-(--ui-surface-hover) focus:border-(--ui-tone-neutral-border) focus:bg-(--ui-surface-hover) disabled:opacity-[var(--ui-disabled-opacity,0.5)] active:scale-[0.995]"
                : "inline-flex h-[var(--ui-control-height-compact)] max-w-full items-center gap-1 rounded-md bg-(--ui-surface-raised) py-0 pr-1.5 pl-2 text-left text-[12px] focus-visible:outline-2 focus-visible:outline-accent hover:bg-(--ui-surface-hover) focus-visible:bg-(--ui-surface-hover) disabled:opacity-[var(--ui-disabled-opacity,0.5)]",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span
          className={`min-w-0 truncate ${variant === "panel" ? "flex-1 text-right" : compact ? "" : "flex-1"} ${framed || !selectedLabel ? "" : "text-content"}`}
          data-placeholder={selectedLabel ? undefined : ""}
          title={selectedLabel}
        >
          <SelectValue value={value} label={selectedLabel ?? placeholder} />
        </span>
        {/* A closed picker still shows that its options are loading; the open list has its own status row. */}
        {loading && !open && !failed ? (
          <Spinner
            data-select-loading=""
            size={compact ? "xs" : "sm"}
            className="text-(--ui-text-secondary)"
          />
        ) : (
          <ChevronDown
            className={`shrink-0 text-(--ui-text-secondary) motion-safe:transition-transform duration-150 ease-out ${compact ? "size-3" : "size-3.5"} ${open ? "rotate-180" : ""}`}
            strokeWidth={1.75}
          />
        )}
      </SelectTrigger>
      {showSelectedValues && multiple && values.length ? (
        <div
          className={`bycoda-selection-values ${styles.values} ${disabled ? styles.valuesDisabled : ""}`}
          aria-label={selectionLabels?.selected ?? label}
        >
          {values.map((value) => {
            const option = optionLookup.get(value);
            const name = option?.label ?? selectionLabels?.missing ?? value;
            return (
              <span
                key={value}
                className={`bycoda-selection-value ${styles.value}`}
                title={option?.description ?? value}
              >
                <span className={styles.valueLabel}>{name}</span>
                <InlineAction
                  reveal="always"
                  label={selectionLabels?.remove?.(name) ?? `${t("Remove")}: ${name}`}
                  disabled={disabled}
                  onClick={() => {
                    if (!disabled) onRemove?.(value);
                  }}
                >
                  <X aria-hidden="true" />
                </InlineAction>
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
          constrainHeight
          layer={popoverLayer}
          role="dialog"
          aria-label={selectionLabels?.menu ?? t("{p0} options", { p0: label })}
          aria-busy={loading || undefined}
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
                className="min-w-0 flex-1 bg-transparent text-[12px] text-content placeholder:text-(--ui-text-muted)"
              />
            </ComboboxSearch>
          ) : null}
          {failed ? (
            <ComboboxStatus
              tone="danger"
              className="shrink-0"
              action={
                onRetry ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    loading={loading}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onRetry}
                  >
                    {retryLabel ?? t("Retry")}
                  </Button>
                ) : null
              }
            >
              {error}
            </ComboboxStatus>
          ) : showLoading ? (
            <ComboboxStatus className="shrink-0">{loadingLabel ?? t("Loading…")}</ComboboxStatus>
          ) : null}
          <ComboboxList
            ref={list}
            id={listId}
            role="listbox"
            aria-label={label}
            aria-multiselectable={multiple || undefined}
            aria-busy={loading || undefined}
            aria-activedescendant={searchable ? undefined : activeId}
            tabIndex={searchable ? undefined : 0}
            onKeyDown={searchable ? undefined : onSearchKeyDown}
            className="min-h-0 flex-1 overflow-y-auto overscroll-none p-1 focus-visible:outline-2 focus-visible:outline-accent"
          >
            {filtered.length > 0 ? (
              filtered.map((option, index) => (
                <OptionRow
                  key={option.value}
                  option={option}
                  index={index}
                  listId={listId}
                  highlighted={index === activeIndex}
                  selected={values.includes(option.value)}
                  compact={compact}
                  query={normalizedQuery ? query : ""}
                  rowRef={index === activeIndex ? activeOption : undefined}
                  controlDisabled={disabled}
                  onPick={pickLatest}
                  onHover={setActive}
                />
              ))
            ) : noResults ? (
              <ComboboxStatus empty>{resultsCopy}</ComboboxStatus>
            ) : null}
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
  if (!composed) return picker;
  return (
    <Field
      label={label}
      hideLabel={!visibleLabel}
      description={description}
      error={fieldError}
      variant={fieldVariant}
      id={triggerId}
      className="min-w-0"
    >
      {picker}
    </Field>
  );
}
