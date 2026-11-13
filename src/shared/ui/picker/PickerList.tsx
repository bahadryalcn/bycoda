import { useLayoutEffect, useRef, type ReactNode, type ComponentPropsWithRef } from "react";
import { useT } from "../../i18n";
import { popupListClassName } from "../Popover";
import { PickerChoice } from "./PickerChoice";
import { ActionHost } from "../ActionHost";
import { Button } from "../Button";
import { MatchText, matchPositions } from "../MatchText";
import { ComboboxItem, ComboboxStatus } from "../arc/combobox/combobox";
import {
  usePickerList,
  type PickerListController,
  type PickerListOptions,
  type PickerOption,
} from "./usePickerList";
import styles from "./picker.module.css";
import comboboxStyles from "../arc/combobox/combobox.module.css";

type PickerListRootProps = { label: string; multiple?: boolean } & (
  | ({ as?: "div" } & Omit<
      ComponentPropsWithRef<"div">,
      "role" | "aria-label" | "aria-multiselectable"
    >)
  | ({ as: "ul" } & Omit<
      ComponentPropsWithRef<"ul">,
      "role" | "aria-label" | "aria-multiselectable"
    >)
);
/**
 * Listbox composition root for an existing editor or virtualized selection controller.
 * Owns only the native listbox semantics; caller keeps active IDs, refs, keys, scrolling and selection.
 * @group choice
 * @use Existing folder, editor suggestion or path-selection controllers needing custom rows and virtualization.
 * @avoid Ordinary values or commands without their own controller: PickerList or DropdownMenu.
 * @replaces role=listbox
 */
export function PickerListRoot(props: PickerListRootProps) {
  if (props.as === "ul") {
    const { as: _as, label, multiple, ...rest } = props;
    return (
      <ul
        {...rest}
        role="listbox"
        aria-label={label}
        aria-multiselectable={multiple || undefined}
      />
    );
  }
  const { as: _as, label, multiple, ...rest } = props;
  return (
    <div {...rest} role="listbox" aria-label={label} aria-multiselectable={multiple || undefined} />
  );
}

/** Value lists show the shared leading check; action lists without a committed value may omit it. */
export type PickerCheckPlacement = "leading" | "none";

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
  /** Compatibility density hint; every row follows the shared control-density token. Descriptions grow. */
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
  /** InlineAction/InlineMoreAction controls, siblings of the option button. */
  renderOptionActions?: (option: PickerOption) => ReactNode;
  /** Entry highlights on hover; movement ignores stationary pointer entry after keyboard scrolling. */
  pointerHighlight?: "entry" | "movement";
  className?: string;
};

/**
 * App-facing popover listbox body: grouped option rows (icon, title, meta, description, trailing, check,
 * disabled reason), single or multi selection, arrow/Home/End/Enter/Space keys and typeahead.
 * @group choice
 * @use Embedded lists or externally controlled pickers with rich rows and action entries.
 * @avoid Trigger plus ordinary value list: SearchableSelect. Commands only: DropdownMenu.
 */
export function PickerList({
  label,
  query = "",
  checkPlacement = "leading",
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
  renderOptionActions,
  pointerHighlight = "entry",
  ...source
}: PickerListProps) {
  const t = useT();
  const controller = source.controller;
  // Hooks run in a fixed order; with a controller the list's own model stays empty and unused.
  const own = usePickerList(controller ? NO_SELECTION : (source as PickerListOptions));
  const list = controller ?? own;
  const listOwnsFocus = !controller && !list.inputRef;
  const pointer = useRef<{ x: number; y: number } | null>(null);
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
    const description =
      option.disabled && option.disabledReason
        ? t("Unavailable: {p0}", { p0: option.disabledReason })
        : option.description;
    const descriptionId = description != null ? `${list.optionId(index)}-description` : undefined;
    const title =
      typeof option.title === "string" && query.trim() ? (
        <MatchText text={option.title} positions={matchPositions(option.title, query)} active />
      ) : (
        option.title
      );
    const button = (
      <ComboboxItem
        key={option.value}
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
        onContextMenu={option.onContextMenu}
        onMouseEnter={() => {
          if (!unavailable && pointerHighlight === "entry") list.setActive(index);
        }}
        onPointerMove={(event) => {
          const previous = pointer.current;
          pointer.current = { x: event.clientX, y: event.clientY };
          if (
            !unavailable &&
            pointerHighlight === "movement" &&
            (!previous || previous.x !== event.clientX || previous.y !== event.clientY)
          )
            list.setActive(index);
        }}
        onClick={() => {
          if (!unavailable) list.commit(index);
        }}
        className={`bycoda-arc-select-option ${styles.row}`}
      >
        <PickerChoice
          selected={selected}
          showSelection={checkPlacement !== "none"}
          icon={option.icon}
          label={title}
          title={typeof option.title === "string" ? option.title : option.textValue}
          description={description}
          descriptionId={descriptionId}
          meta={option.meta}
          trailing={option.trailing}
        />
      </ComboboxItem>
    );
    const actions = renderOptionActions?.(option);
    return actions == null ? (
      button
    ) : (
      <ActionHost key={option.value} selected={selected} className={styles.actionRow}>
        {button}
        <div data-picker-actions="" className={styles.actions}>
          {actions}
        </div>
      </ActionHost>
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
      <PickerListRoot
        ref={root}
        id={list.listId}
        label={label}
        multiple={list.multiple}
        aria-busy={loading || undefined}
        aria-activedescendant={listOwnsFocus ? list.activeOptionId : undefined}
        tabIndex={listOwnsFocus ? 0 : -1}
        onKeyDown={(event) => {
          if (!(event.target instanceof Element)) return;
          // Inline actions keep their own keyboard activation and navigation.
          if (event.target.closest("[data-picker-actions]")) return;
          // A controller normally keeps focus in search; a clicked option can own it too.
          if (listOwnsFocus || event.target.getAttribute("role") === "option")
            list.onListKeyDown(event);
        }}
        className={`${comboboxStyles.listbox} ${styles.list} ${popupListClassName}`}
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
      </PickerListRoot>
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
        if (event.target instanceof HTMLElement && event.target.closest("button"))
          event.preventDefault();
      }}
    >
      {children}
    </div>
  );
}
