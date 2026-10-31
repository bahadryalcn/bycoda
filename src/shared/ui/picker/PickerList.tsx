import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useT } from "../../i18n";
import { Check } from "../icons";
import { Button } from "../Button";
import { MatchText, matchPositions } from "../MatchText";
import { ComboboxItem, ComboboxList, ComboboxStatus } from "../arc/combobox/combobox";
import {
  usePickerList,
  type PickerListController,
  type PickerListOptions,
  type PickerOption,
} from "./usePickerList";
import styles from "./picker.module.css";

/**
 * Where the selected check sits: `trailing` (default, own end column), `leading` (before the icon),
 * `icon` (replaces the icon of the selected row) or `none` (selection shown by the fill only).
 */
export type PickerCheckPlacement = "trailing" | "leading" | "icon" | "none";

type PickerListSource =
  | (PickerListOptions & { controller?: undefined })
  | {
      /**
       * From `usePickerList` when a search header drives the list (options and selection come from it);
       * without one the list owns focus, keys and typeahead.
       */
      controller: PickerListController;
    };

const NO_SELECTION: PickerListOptions = { options: [], value: null, onChange: () => undefined };

export type PickerListProps = PickerListSource & {
  /** Accessible name of the listbox. */
  label: string;
  /** Raw query, to accent matched text in string titles. */
  query?: string;
  checkPlacement?: PickerCheckPlacement;
  /** `sm` 28px rows for toolbars; `md` (default) 32px rows. Rows with a description grow. */
  density?: "sm" | "md";
  /** Focus the list on mount (list-owned focus only). */
  autoFocus?: boolean;
  /** Async presentation: the committed rows stay choosable during loading and after a failure. */
  loading?: boolean;
  loadingLabel?: string;
  error?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  /** Copy for an empty list. */
  emptyLabel?: ReactNode;
  /** Every row is unavailable (an async pick is running). */
  disabled?: boolean;
  className?: string;
};

/**
 * App-facing popover listbox body: grouped option rows (icon, title, meta, description, trailing, check,
 * disabled reason), single or multi selection, arrow/Home/End/Enter/Space keys and typeahead.
 */
export function PickerList({
  label,
  query = "",
  checkPlacement = "trailing",
  density = "md",
  autoFocus = false,
  loading = false,
  loadingLabel,
  error,
  onRetry,
  retryLabel,
  emptyLabel,
  disabled = false,
  className,
  ...source
}: PickerListProps) {
  const t = useT();
  const controller = source.controller;
  // Hooks run in a fixed order; with a controller the list's own model stays empty and unused.
  const own = usePickerList(controller ? NO_SELECTION : (source as PickerListOptions));
  const list = controller ?? own;
  const listOwnsFocus = !controller;
  const root = useRef<HTMLDivElement>(null);
  const failed = error != null && error !== false && error !== "";

  useLayoutEffect(() => {
    if (!autoFocus || !listOwnsFocus) return;
    root.current?.focus({ preventScroll: true });
  }, [autoFocus, listOwnsFocus]);
  useLayoutEffect(() => {
    if (list.activeIndex < 0) return;
    root.current
      ?.querySelector<HTMLElement>(`[id="${list.optionId(list.activeIndex)}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the row id derives from these two.
  }, [list.activeIndex, list.listId]);

  // Consecutive options sharing a group form one labelled group.
  const sections: { group?: string; start: number; options: PickerOption[] }[] = [];
  list.options.forEach((option, index) => {
    const current = sections[sections.length - 1];
    if (current && current.group === option.group) current.options.push(option);
    else sections.push({ group: option.group, start: index, options: [option] });
  });

  const row = (option: PickerOption, index: number) => {
    const selected = !option.onAction && list.isSelected(option.value);
    const highlighted = index === list.activeIndex;
    const unavailable = disabled || !!option.disabled;
    const description = option.disabled && option.disabledReason
      ? t("Unavailable: {p0}", { p0: option.disabledReason })
      : option.description;
    const descriptionId = description != null ? `${list.optionId(index)}-description` : undefined;
    const check = selected ? <Check aria-hidden className="icon-sm" strokeWidth={1.75} /> : null;
    const icon = checkPlacement === "icon" && selected ? check : option.icon;
    const title =
      typeof option.title === "string" && query.trim() ? (
        <MatchText text={option.title} positions={matchPositions(option.title, query)} active />
      ) : (
        option.title
      );
    return (
      <ComboboxItem
        key={`${option.value}\u0000${index}`}
        id={list.optionId(index)}
        type="button"
        role="option"
        tabIndex={-1}
        aria-selected={list.multiple || !option.onAction ? selected : undefined}
        aria-disabled={unavailable || undefined}
        aria-describedby={descriptionId}
        disabled={unavailable}
        data-highlighted={highlighted || undefined}
        data-active={highlighted || undefined}
        data-density={density}
        data-has-description={description != null ? "" : undefined}
        data-picker-action={option.onAction ? "" : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => {
          if (!unavailable) list.setActive(index);
        }}
        onClick={() => {
          if (!unavailable) list.commit(index);
        }}
        className={`bycoda-arc-select-option ${styles.row}`}
      >
        {checkPlacement === "leading" ? <span className={styles.check}>{check}</span> : null}
        {icon != null || checkPlacement === "icon" ? (
          <span className={styles.icon} aria-hidden>
            {icon}
          </span>
        ) : null}
        <span className={styles.body}>
          <span className={styles.titleLine}>
            <span className={styles.title}>{title}</span>
            {option.meta != null ? <span className={styles.meta}>{option.meta}</span> : null}
          </span>
          {description != null ? (
            <span id={descriptionId} className={styles.description}>
              {description}
            </span>
          ) : null}
        </span>
        {option.trailing != null ? <span className={styles.trailing}>{option.trailing}</span> : null}
        {checkPlacement === "trailing" ? <span className={styles.check}>{check}</span> : null}
      </ComboboxItem>
    );
  };

  return (
    <div className={["bycoda-arc", styles.listRoot, className].filter(Boolean).join(" ")}>
      {failed ? (
        <ComboboxStatus
          tone="danger"
          className={styles.status}
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
      ) : loading ? (
        <ComboboxStatus className={styles.status}>{loadingLabel ?? t("Loading…")}</ComboboxStatus>
      ) : null}
      <ComboboxList
        ref={root}
        id={list.listId}
        role="listbox"
        aria-label={label}
        aria-multiselectable={list.multiple || undefined}
        aria-busy={loading || undefined}
        aria-activedescendant={listOwnsFocus ? list.activeOptionId : undefined}
        tabIndex={listOwnsFocus ? 0 : -1}
        onKeyDown={listOwnsFocus ? list.onListKeyDown : undefined}
        className={styles.list}
      >
        {sections.map((section) =>
          section.group ? (
            <div
              key={`${section.group}\u0000${section.start}`}
              role="group"
              aria-labelledby={`${list.listId}-group-${section.start}`}
              className={styles.group}
            >
              <div
                id={`${list.listId}-group-${section.start}`}
                role="presentation"
                className={styles.groupHeading}
              >
                {section.group}
              </div>
              {section.options.map((option, offset) => row(option, section.start + offset))}
            </div>
          ) : (
            section.options.map((option, offset) => row(option, section.start + offset))
          ),
        )}
        {list.options.length === 0 && !loading && !failed ? (
          <ComboboxStatus empty>{emptyLabel ?? t("No matching options")}</ComboboxStatus>
        ) : null}
      </ComboboxList>
    </div>
  );
}

/** Action row under a picker list (Clear, Done, Manage…, a primary submit). Keeps focus in the list on press. */
export function PickerFooter({
  children,
  align = "end",
  className,
}: {
  children: ReactNode;
  /** `between` puts the first child at the start, the rest at the end. */
  align?: "start" | "end" | "between";
  className?: string;
}) {
  return (
    <div
      data-picker-footer=""
      data-align={align}
      className={[styles.footer, className].filter(Boolean).join(" ")}
      onMouseDown={(event) => {
        // Pressing a footer action must not blur the search field or list first.
        if (event.target instanceof HTMLElement && event.target.closest("button")) event.preventDefault();
      }}
    >
      {children}
    </div>
  );
}
