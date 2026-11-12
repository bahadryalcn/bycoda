import { popupListClassName } from "./Popover";
import { OverflowTooltip } from "./Tooltip";
import { useT } from "../i18n";
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
  type CSSProperties,
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
import { Badge } from "./Badge";
import { Field, fieldDescribedBy, type FieldVariant } from "./Field";
import { MatchText, matchPositions } from "./MatchText";
import styles from "./SearchableSelect.module.css";
import { LAYER } from "../lib/layers";
import type { PopoverAlign, PopoverSide } from "../lib/popover";
import { Popover } from "./Popover";
import { InlineAction } from "./ActionHost";
import { Button } from "./Button";
import { useTooltip, type TooltipContent } from "./Tooltip";
import { isImeComposition } from "../lib/keyboard";
import { SelectTrigger, SelectValue } from "./arc/select/select";
import { ComboboxItem, ComboboxList, ComboboxStatus } from "./arc/combobox/combobox";
import { PopoverSearchHeader } from "./PopoverSearchHeader";
import { PickerChoice } from "./picker/PickerChoice";
import { PickerFooter } from "./picker/PickerList";
import {
  ALL_GROUPS,
  filterByGroup,
  groupFilterSegments,
  SearchableSelectGroupFilter,
} from "./SearchableSelectGroupFilter";

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
  /** Style of the label text only (a font picker paints each name in its own font). */
  labelStyle?: CSSProperties;
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
    "aria-readonly"?: boolean;
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
 * Shared Field composition: the label is shown above the trigger by default (like Select), with help and a
 * validation message. `hideLabel` renders the bare trigger and keeps the label for assistive tech only.
 * `fieldError` is the validation message; the async-load `error` stays inside the list.
 */
type FieldOptions = {
  /** Keep `label` for assistive tech only (toolbars and compact filters that supply their own context). */
  hideLabel?: boolean;
  description?: string;
  fieldError?: string;
  fieldVariant?: FieldVariant;
};

type SelectionOptions = AsyncOptions &
  FieldOptions & {
    /** Keep the committed value focusable without allowing the list to open. */
    readOnly?: boolean;
    /** Preserve ownership and interaction data hooks on the portalled popup. */
    menuAttributes?: { [attribute: `data-${string}`]: string | boolean | undefined };
    /** Called after dismissal or selection; true when focus returned to the trigger. */
    onClose?: (restoreFocus: boolean) => void;
    /** Locale used for case folding, independently of the UI language. */
    searchLocale?: string;
    triggerProps?: Omit<
      ComponentPropsWithRef<"button">,
      "children" | "value" | "onChange" | "disabled"
    > & {
      /** Same as the `tooltip` prop (the prop wins). */
      tooltip?: SelectionOptions["tooltip"];
      [attribute: `data-${string}`]: string | boolean | undefined;
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

/**
 * Trigger plus popover list with a type-to-filter header; single or multiple values, grouped options, async states.
 * Options take `icon`, `description`, `meta`, `group`; consecutive groups have compact sticky headings retained when filtering.
 * Selected icons appear inside the trigger; option descriptions render below labels and are searched.
 * `renderTrigger` swaps the trigger, `footer` adds actions, `fieldVariant`/`description` add field chrome.
 * Shows its label above the trigger like Select; `hideLabel` keeps it for assistive tech only (toolbars, compact filters).
 * The caller owns value, fetching and retry; the picker keeps the committed value visible while loading.
 * Menus fit their content within the viewport; long labels and descriptions truncate with full text on hover/focus.
 * `groupFilter` adds a one-row filter by option `group` (needs two or more groups; PageUp/PageDown switch it from the search field); `menuMinWidth` and `menuMaxHeight` enlarge the menu.
 * Trigger variants are owned here: `field` is a labelled form control; `transparent` is an
 * unfilled field in an existing surface; `row` and `pill` are compact toolbar controls;
 * `panel` is a full-width value row in a touch panel. All share the same option rows.
 * @group choice
 * @use Long or growing list filtered by typing, one or many values, no free entry (branches, projects, models).
 * @avoid Short stable list: Select. Free text or custom values: Combobox. Commands without a selection: DropdownMenu. `hideLabel` only where context is supplied.
 */
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
    /** Preferred opening side; Popover flips to the opposite edge when needed. */
    side?: PopoverSide;
    align?: PopoverAlign;
    /** Menu width floor in px (never narrower than the trigger). Default 240. */
    menuMinWidth?: number;
    /** Menu height cap in px for searchable or long lists. Default 240. */
    menuMaxHeight?: number;
    /** Show an "All" plus per-group filter above the list when options have two or more distinct groups. */
    groupFilter?: boolean;
  } & SelectionOptions &
    (SingleSelectProps | MultiSelectProps),
) {
  return (
    <SearchableSelectMenu
      {...props}
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
  const title = option.description ? `${option.label} ${option.description}` : option.label;
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
      data-density={compact ? "sm" : "md"}
      data-has-description={option.description ? "" : undefined}
      data-active={highlighted || undefined}
      data-highlighted={highlighted || undefined}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={() => {
        if (!option.disabled) onHover(index);
      }}
      onClick={() => onPick(option.value)}
      className={`bycoda-arc-select-option`}
    >
      <PickerChoice
        selected={selected}
        icon={option.icon}
        label={
          <span style={option.labelStyle}>
            <MatchText
              text={option.label}
              positions={matchPositions(option.label, query)}
              active={query.trim().length > 0}
            />
          </span>
        }
        description={option.description}
        descriptionId={`${listId}-description-${index}`}
        title={title}
        meta={option.meta}
      />
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
  placeholder: placeholderOption,
  searchPlaceholder: searchPlaceholderOption,
  emptyLabel: emptyLabelOption,
  disabled = false,
  readOnly = false,
  onClose,
  menuAttributes,
  layer,
  variant = "field",
  searchable = true,
  side = "bottom",
  align = "end",
  menuMinWidth = 240,
  menuMaxHeight = 240,
  groupFilter = false,
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
  hideLabel = false,
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
  side?: PopoverSide;
  align?: PopoverAlign;
  menuMinWidth?: number;
  menuMaxHeight?: number;
  groupFilter?: boolean;
} & SelectionOptions) {
  const t = useT();
  const placeholder = placeholderOption ?? t("Choose an option…");
  const searchPlaceholder = searchPlaceholderOption ?? t("Search options…");
  const emptyLabel = emptyLabelOption ?? t("No matching options");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [groupKey, setGroupKey] = useState(ALL_GROUPS);
  const [menuWidth, setMenuWidth] = useState<number>();
  // A disabled picker cannot stay open: close during render so re-enabling does not reopen it.
  if ((disabled || readOnly) && (open || query)) {
    setOpen(false);
    setQuery("");
    setGroupKey(ALL_GROUPS);
  }
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useImperativeHandle(triggerProps?.ref, () => trigger.current!, []);
  const search = useRef<HTMLInputElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const activeOption = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const generatedTriggerId = useId();
  const triggerId = triggerProps?.id ?? generatedTriggerId;
  const composed = !hideLabel || Boolean(description) || Boolean(fieldError);
  const optionLookup = useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options],
  );
  const value = values.join("\n");
  const selectedLabel =
    values.length && selectionLabels?.summary
      ? selectionLabels.summary(values.length)
      : values.length > 1
        ? values.map((item) => optionLookup.get(item)?.label ?? item).join(", ")
        : (optionLookup.get(values[0])?.label ?? (values[0] || undefined));
  const normalizedQuery = query.trim().toLocaleLowerCase(searchLocale);
  const groupSegments = useMemo(
    () => (groupFilter ? groupFilterSegments(options, t) : []),
    [groupFilter, options, t],
  );
  // A group that vanished from the options falls back to "All".
  const scoped = useMemo(
    () =>
      groupSegments.some((segment) => segment.value === groupKey)
        ? filterByGroup(options, groupKey)
        : options,
    [groupSegments, options, groupKey],
  );
  const filtered = useMemo(
    () =>
      normalizedQuery
        ? scoped.filter((option) =>
            `${option.label}\n${option.description ?? ""}\n${option.keywords ?? ""}\n${typeof option.meta === "string" ? option.meta : ""}\n${option.group ?? ""}`
              .toLocaleLowerCase(searchLocale)
              .includes(normalizedQuery),
          )
        : [...scoped],
    [normalizedQuery, scoped, searchLocale],
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
    setGroupKey(ALL_GROUPS);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
    if (open) onClose?.(restoreFocus);
  };

  const openMenu = () => {
    if (disabled || readOnly || trigger.current?.matches(":disabled")) return;
    setMenuWidth(Math.max(menuMinWidth, trigger.current?.getBoundingClientRect().width ?? 0));
    setQuery("");
    setGroupKey(ALL_GROUPS);
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
    if (disabled || readOnly || optionLookup.get(next)?.disabled) return;
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
    if (event.key === "Tab") {
      if (!event.shiftKey && retry.current) {
        event.preventDefault();
        retry.current.focus({ preventScroll: true });
      } else close(true);
      return;
    }
    // PageUp/PageDown cycle the category filter without leaving the search field.
    if ((event.key === "PageUp" || event.key === "PageDown") && groupSegments.length > 0) {
      event.preventDefault();
      const at = Math.max(
        0,
        groupSegments.findIndex((segment) => segment.value === groupKey),
      );
      const next =
        groupSegments[
          (at + (event.key === "PageDown" ? 1 : -1) + groupSegments.length) % groupSegments.length
        ]!;
      setGroupKey(next.value);
      setActive(0);
      return;
    }
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
  // An empty list says why: loading and failure have their own rows and are never "no matches".
  const noResults = !loading && !failed && filtered.length === 0;
  const resultsCopy =
    options.length === 0 && !normalizedQuery ? (noOptionsLabel ?? emptyLabel) : emptyLabel;

  const selectedOption = optionLookup.get(values[0] ?? "");
  // Shared tooltip: only while the list is closed, so it never covers the open menu.
  const { tooltip: triggerTooltip, ...triggerDomProps } = triggerProps ?? {};
  const tooltipSource = tooltipProp ?? triggerTooltip;
  const tooltipContent: TooltipContent =
    typeof tooltipSource === "string"
      ? { label: tooltipSource }
      : (tooltipSource ?? { label: selectedLabel, when: "overflow" });
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
    "aria-readonly": readOnly || undefined,
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
          >
            <SelectValue value={value} label={selectedLabel ?? placeholder} />
          </span>
          {multiple && values.length > 0 ? (
            <Badge tone="neutral" size="xs" className="shrink-0 tabular-nums" aria-hidden>
              {values.length}
            </Badge>
          ) : null}
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
              <OverflowTooltip key={value} label={option?.description ?? value}>
                <span className={`bycoda-selection-value ${styles.value}`}>
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
              </OverflowTooltip>
            );
          })}
        </div>
      ) : null}
      {open ? (
        <Popover
          {...menuAttributes}
          id={`${listId}-menu`}
          anchor={trigger}
          side={side}
          align={align}
          gap={4}
          minWidth={menuWidth}
          maxHeight={longMenu ? menuMaxHeight : undefined}
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
          {groupFilter ? (
            <SearchableSelectGroupFilter
              options={options}
              value={groupKey}
              onChange={(next) => {
                setGroupKey(next);
                setActive(0);
              }}
            />
          ) : null}
          {failed ? (
            <ComboboxStatus
              tone="danger"
              className="shrink-0"
              action={
                onRetry ? (
                  <Button
                    ref={retry}
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
            className={`${popupListClassName} min-h-0 flex-1 overflow-y-auto overscroll-none focus-visible:outline-2 focus-visible:outline-accent`}
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
      hideLabel={hideLabel}
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
