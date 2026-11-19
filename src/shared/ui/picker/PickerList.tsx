import { useLayoutEffect, useRef, type ReactNode, type ComponentPropsWithRef } from "react";
import { useT } from "../../i18n";
import { popupListClassName } from "../Popover";
import { PickerChoice } from "./PickerChoice";
import { usePointerMovement } from "./usePointerMovement";
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
import {
  PICKER_WINDOW_THRESHOLD,
  usePickerWindow,
  type PickerWindowEntry,
} from "./usePickerWindow";
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

const NO_SELECTION: PickerListOptions = {
  options: [],
  value: null,
  onChange: () => undefined,
};

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
  /** Movement (default) ignores stationary pointer entry after keyboard scrolling; entry highlights on hover. */
  pointerHighlight?: "entry" | "movement";
  /** `standard` bounds the list to the shared picker height and scrolls inside it. */
  listHeight?: "standard";
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
  pointerHighlight = "movement",
  listHeight,
  ...source
}: PickerListProps) {
  const t = useT();
  const controller = source.controller;
  // Hooks run in a fixed order; with a controller the list's own model stays empty and unused.
  const own = usePickerList(controller ? NO_SELECTION : (source as PickerListOptions));
  const list = controller ?? own;
  const listOwnsFocus = !controller && !list.inputRef;
  const pointerMoved = usePointerMovement();
  const root = useRef<HTMLDivElement>(null);
  const failed = error != null && error !== false && error !== "";

  useLayoutEffect(() => {
    if (!autoFocus || !listOwnsFocus) return;
    root.current?.focus({ preventScroll: true });
  }, [autoFocus, listOwnsFocus]);

  // Consecutive options sharing a group form one labelled group.
  const sections: { group?: string; start: number; options: PickerOption[] }[] = [];
  list.options.forEach((option, index) => {
    const current = sections[sections.length - 1];
    if (current && current.group === option.group) current.options.push(option);
    else sections.push({ group: option.group, start: index, options: [option] });
  });

  // A long list mounts only the rows near the viewport; headings and options are windowed together.
  const windowed = list.options.length > PICKER_WINDOW_THRESHOLD;
  const entries: PickerWindowEntry[] = [];
  const entryOfOption: number[] = [];
  if (windowed) {
    for (const section of sections) {
      if (section.group)
        entries.push({ kind: "heading", key: `heading:${section.start}`, group: section.group });
      section.options.forEach((option, offset) => {
        entryOfOption[section.start + offset] = entries.length;
        entries.push({
          kind: "option",
          key: `option:${option.value}`,
          index: section.start + offset,
        });
      });
    }
  }
  const win = usePickerWindow(entries, () => root.current, windowed);
  const activeEntry = list.activeIndex >= 0 ? entryOfOption[list.activeIndex] : undefined;

  useLayoutEffect(() => {
    if (list.activeIndex < 0) return;
    // An unmounted windowed row is brought into the window first; the virtualizer scrolls to its offset.
    if (windowed) {
      if (activeEntry !== undefined) win.scrollToEntry(activeEntry);
      return;
    }
    root.current
      ?.querySelector<HTMLElement>(`[id="${list.optionId(list.activeIndex)}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the row id derives from these two; the window follows the active entry.
  }, [list.activeIndex, list.listId, windowed, activeEntry]);

  const row = (option: PickerOption, index: number) => {
    // The outermost row element is measured, so inline actions and descriptions size the window.
    const measure = windowed
      ? ({ ref: win.measureElement, "data-index": entryOfOption[index] } as const)
      : {};
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
    const actions = renderOptionActions?.(option);
    const button = (
      <ComboboxItem
        key={option.value}
        {...(actions == null ? measure : {})}
        id={list.optionId(index)}
        type="button"
        role="option"
        aria-setsize={windowed ? list.options.length : undefined}
        aria-posinset={windowed ? index + 1 : undefined}
        tabIndex={-1}
        aria-selected={list.multiple || !option.onAction ? selected : undefined}
        aria-disabled={unavailable || undefined}
        aria-haspopup={option.popup ? "listbox" : undefined}
        aria-expanded={option.popup ? option.popup.expanded : undefined}
        aria-controls={option.popup?.expanded ? option.popup.listId : undefined}
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
          if (pointerHighlight !== "movement") return;
          if (pointerMoved(event) && !unavailable) list.setActive(index);
        }}
        onClick={() => {
          if (!unavailable) list.commit(index);
        }}
        className={styles.row}
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
    return actions == null ? (
      button
    ) : (
      <ActionHost key={option.value} {...measure} selected={selected} className={styles.actionRow}>
        {button}
        <div data-picker-actions="" className={styles.actions}>
          {actions}
        </div>
      </ActionHost>
    );
  };

  const fullBody = () =>
    sections.map((section) =>
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
    );

  // The window renders a contiguous slice between two spacers that stand in for the unmounted rows.
  // A group cut by the slice keeps its name (aria-label), so the group stays announced without its heading.
  const windowBody = () => {
    const blocks: { group?: string; key: string; children: ReactNode[] }[] = [];
    for (const item of win.items) {
      const entry = entries[item.index];
      if (!entry) continue;
      if (entry.kind === "heading") {
        blocks.push({
          group: entry.group,
          key: entry.key,
          children: [
            <div
              key={entry.key}
              ref={win.measureElement}
              data-index={item.index}
              role="presentation"
              className={styles.groupHeading}
            >
              {entry.group}
            </div>,
          ],
        });
        continue;
      }
      const option = list.options[entry.index]!;
      const last = blocks[blocks.length - 1];
      if (option.group && last?.group === option.group)
        last.children.push(row(option, entry.index));
      else
        blocks.push({ group: option.group, key: entry.key, children: [row(option, entry.index)] });
    }
    const lead = win.items[0]?.start ?? 0;
    const tail = win.items.length ? win.totalSize - win.items[win.items.length - 1]!.end : 0;
    return (
      <>
        {lead > 0 ? <div aria-hidden style={{ blockSize: lead }} /> : null}
        {blocks.map((block) =>
          block.group ? (
            <div key={block.key} role="group" aria-label={block.group} className={styles.group}>
              {block.children}
            </div>
          ) : (
            block.children
          ),
        )}
        {tail > 0 ? <div aria-hidden style={{ blockSize: tail }} /> : null}
      </>
    );
  };

  return (
    <div
      data-list-height={listHeight}
      className={[
        "bycoda-arc",
        styles.listRoot,
        listHeight === "standard" ? styles.standardHeight : undefined,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
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
        {windowed ? windowBody() : fullBody()}
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
