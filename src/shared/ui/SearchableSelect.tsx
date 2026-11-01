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
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { ChevronDown, X } from "./icons";
import { Spinner } from "./Spinner";
import { Field, fieldDescribedBy, type FieldVariant } from "./Field";
import { MatchText, matchPositions } from "./MatchText";
import styles from "./SearchableSelect.module.css";
import { LAYER } from "../lib/layers";
import type { PopoverAlign } from "../lib/popover";
import { Popover } from "./Popover";
import { InlineAction } from "./ActionHost";
import { Button } from "./Button";
import { useTooltip, type TooltipContent } from "./Tooltip";
import { isImeComposition } from "../lib/keyboard";
import { SelectTrigger, SelectValue } from "./arc/select/select";
import {
  ComboboxChoice,
  ComboboxItem,
  ComboboxList,
  ComboboxStatus,
} from "./arc/combobox/combobox";
import { PopoverSearchHeader } from "./PopoverSearchHeader";
import { PickerFooter } from "./picker/PickerList";

export type SearchableSelectOption = {
  value: string;
  label: string;
  keywords?: string;
  description?: string;
  disabled?: boolean;
  /** Leading glyph, logo or avatar (icon-sm/icon-md); also shown in the trigger for the selected value. */
  icon?: ReactNode;
  /** Short end-aligned secondary text on the row (path, account, count). A string is also searched. */
  meta?: ReactNode;
  /** Consecutive options with the same group render under one heading. */
  group?: string;
};

/** What a custom trigger receives: spread `props` on a button, read the rest for its content. */
export type SearchableSelectTriggerRender = {
  props: {
    ref: Ref<HTMLButtonElement>;
    id?: string;
    type: "button" | "submit" | "reset";
    disabled: boolean;
    "aria-label": string;
    "aria-expanded": boolean;
    "aria-haspopup": "dialog";
    "aria-controls"?: string;
    "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling";
    "aria-describedby"?: string;
    "aria-busy"?: boolean | "true" | "false";
    "data-state": "open" | "closed";
    onClick: (event: MouseEvent<HTMLButtonElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
    /** Hover and focus wiring of the shared `tooltip`; spread with the rest. */
    onPointerEnter: (event: PointerEvent<HTMLButtonElement>) => void;
    onPointerLeave: (event: PointerEvent<HTMLButtonElement>) => void;
    onFocus: (event: FocusEvent<HTMLButtonElement>) => void;
    onBlur: (event: FocusEvent<HTMLButtonElement>) => void;
  };
  open: boolean;
  /** The selected label (or a summary for several values); undefined means the placeholder shows. */
  selectedLabel?: string;
  placeholder: string;
  selected: readonly SearchableSelectOption[];
  loading: boolean;
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

type SelectionOptions = AsyncOptions &
  FieldOptions & {
    /** Locale used for case folding, independently of the UI language. */
    searchLocale?: string;
    triggerProps?: Omit<
      ComponentPropsWithRef<"button">,
      "children" | "value" | "onChange" | "disabled"
    > & {
      /** Same as the `tooltip` prop (the prop wins). */
      tooltip?: SelectionOptions["tooltip"];
    };
    /** Shared tooltip on the trigger while the list is closed (hover and keyboard focus). A string
     *  is the title; an object adds `details`, `shortcut`, `side`, `wide`. Also read from
     *  `triggerProps.tooltip`. Never a native `title`. */
    tooltip?:
      | string
      | Pick<TooltipContent, "label" | "details" | "shortcut" | "side" | "align" | "wide">;
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
    /**
     * Replaces the default trigger. Spread `trigger.props` on a Button (or another button element) so the
     * open state, keyboard opening, labelling and field wiring stay intact.
     */
    renderTrigger?: (trigger: SearchableSelectTriggerRender) => ReactElement;
    /** Actions below the list ("Manage…", "New…"); `close` closes the menu and returns focus to the trigger. */
    footer?: ReactNode | ((menu: { close: () => void }) => ReactNode);
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
    tooltip,
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
    renderTrigger,
    footer,
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
        tooltip,
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
        renderTrigger,
        footer,
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
        icon={option.icon}
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
      {option.meta != null ? <span className={styles.optionMeta}>{option.meta}</span> : null}
    </ComboboxItem>
  );
});

/** Consecutive options sharing a group; ungrouped lists stay one flat section. */
function optionSections(options: readonly SearchableSelectOption[]) {
  const sections: {
    group?: string;
    start: number;
    options: SearchableSelectOption[];
  }[] = [];
  options.forEach((option, index) => {
    const current = sections[sections.length - 1];
    if (current && current.group === option.group) current.options.push(option);
    else sections.push({ group: option.group, start: index, options: [option] });
  });
  return sections;
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
  tooltip: tooltipProp,
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
  renderTrigger,
  footer,
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
            `${option.label}\n${option.description ?? ""}\n${option.keywords ?? ""}\n${typeof option.meta === "string" ? option.meta : ""}\n${option.group ?? ""}`
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

  const selectedOption = optionLookup.get(values[0] ?? "");
  // Shared tooltip: only while the list is closed, so it never covers the open menu.
  const { tooltip: triggerTooltip, ...triggerDomProps } = triggerProps ?? {};
  const tooltipSource = tooltipProp ?? triggerTooltip;
  const tooltipContent: TooltipContent =
    typeof tooltipSource === "string" ? { label: tooltipSource } : (tooltipSource ?? {});
  const hint = useTooltip({
    ...tooltipContent,
    label: open ? undefined : tooltipContent.label,
    details: open ? undefined : tooltipContent.details,
    shortcut: open ? undefined : tooltipContent.shortcut,
    describe: false,
  });
  // The trigger's state, labelling, field wiring and opening keys; shared by the default and a custom trigger.
  const triggerWiring: SearchableSelectTriggerRender["props"] = {
    id: composed ? triggerId : triggerProps?.id,
    ref: trigger,
    type: triggerProps?.type ?? "button",
    disabled,
    "aria-invalid": fieldError ? true : triggerProps?.["aria-invalid"],
    "aria-describedby": composed
      ? fieldDescribedBy(
          triggerId,
          { description, error: fieldError },
          triggerProps?.["aria-describedby"],
        )
      : triggerProps?.["aria-describedby"],
    "aria-label": triggerProps?.["aria-label"] ?? `${label}: ${selectedLabel ?? placeholder}`,
    "aria-busy": loading || triggerProps?.["aria-busy"],
    "aria-expanded": open,
    "aria-haspopup": "dialog",
    "aria-controls": open ? `${listId}-menu` : undefined,
    "data-state": open ? "open" : "closed",
    onPointerEnter: (event) => {
      triggerProps?.onPointerEnter?.(event);
      hint.trigger.onPointerEnter(event);
    },
    onPointerLeave: (event) => {
      triggerProps?.onPointerLeave?.(event);
      hint.trigger.onPointerLeave();
    },
    onFocus: (event) => {
      triggerProps?.onFocus?.(event);
      if (!event.defaultPrevented) hint.trigger.onFocus(event);
    },
    onBlur: (event) => {
      hint.hide();
      triggerProps?.onBlur?.(event);
    },
    onClick: (event) => {
      hint.hide();
      triggerProps?.onClick?.(event);
      if (event.defaultPrevented) return;
      if (open) close();
      else openMenu();
    },
    onKeyDown: (event) => {
      if (event.key === "Escape") hint.hide();
      triggerProps?.onKeyDown?.(event);
      if (event.defaultPrevented || isImeComposition(event.nativeEvent)) return;
      if (open || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
      event.preventDefault();
      openMenu();
    },
  };

  const picker = (
    <div
      ref={root}
      className={
        variant === "pill" || variant === "row"
          ? "relative inline-flex max-w-56 shrink-0"
          : "relative min-w-0"
      }
    >
      {renderTrigger ? (
        renderTrigger({
          props: triggerWiring,
          open,
          selectedLabel,
          placeholder,
          selected: values.flatMap((item) => optionLookup.get(item) ?? []),
          loading,
        })
      ) : (
        <SelectTrigger
          {...triggerDomProps}
          {...triggerWiring}
          data-select-variant={variant}
          data-disabled={disabled || undefined}
          data-loading={loading || undefined}
          className={[
            triggerProps?.className,
            // Field and transparent triggers share the Select frame (border, surface, height, hover, focus, invalid and
            // disabled roles); the compact variants are deliberate toolbar shapes with their own utilities.
            framed
              ? `bycoda-arc-select text-left ${variant === "transparent" ? "bg-transparent" : ""}`
              : variant === "row"
                ? "inline-flex h-[var(--ui-control-height-compact)] max-w-full items-center gap-1 rounded-md bg-(--ui-surface-raised) py-0 pr-1.5 pl-2 text-left text-[12px] hover:bg-(--ui-surface-hover) disabled:opacity-[var(--ui-disabled-opacity,0.5)]"
                : variant === "panel"
                  ? "flex h-14 w-full items-center justify-end gap-3 rounded-xl border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) px-4 text-right text-[14px] font-medium hover:bg-(--ui-surface-hover) disabled:opacity-[var(--ui-disabled-opacity,0.5)] active:scale-[0.995]"
                  : "inline-flex h-[var(--ui-control-height-compact)] max-w-full items-center gap-1 rounded-md bg-(--ui-surface-raised) py-0 pr-1.5 pl-2 text-left text-[12px] hover:bg-(--ui-surface-hover) disabled:opacity-[var(--ui-disabled-opacity,0.5)]",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {!multiple && selectedOption?.icon != null ? (
            <span className={styles.triggerIcon} aria-hidden>
              {selectedOption.icon}
            </span>
          ) : null}
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
      )}
      {open ? null : hint.tooltip}
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
            <PopoverSearchHeader
              ref={search}
              label={searchPlaceholder}
              placeholder={searchPlaceholder}
              // The menu focuses the field itself once it has been placed.
              autoFocus={false}
              listId={listId}
              activeOptionId={activeId}
              value={query}
              onValueChange={(next) => {
                setQuery(next);
                setActive(0);
              }}
              onKeyDown={onSearchKeyDown}
            />
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
              optionSections(filtered).map((section) => {
                const rows = section.options.map((option, offset) => {
                  const index = section.start + offset;
                  return (
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
                  );
                });
                if (!section.group) return rows;
                const headingId = `${listId}-group-${section.start}`;
                return (
                  <div
                    key={headingId}
                    role="group"
                    aria-labelledby={headingId}
                    className={styles.group}
                  >
                    <div id={headingId} role="presentation" className={styles.groupHeading}>
                      {section.group}
                    </div>
                    {rows}
                  </div>
                );
              })
            ) : noResults ? (
              <ComboboxStatus empty>{resultsCopy}</ComboboxStatus>
            ) : null}
          </ComboboxList>
          {onClear && (values.length > 0 || selectionLabels?.done) ? (
            <PickerFooter>
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
            </PickerFooter>
          ) : null}
          {footer != null ? (
            <PickerFooter>
              {typeof footer === "function" ? footer({ close: () => close(true) }) : footer}
            </PickerFooter>
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
