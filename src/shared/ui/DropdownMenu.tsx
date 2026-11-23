import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { contextMenuSlotClassName as slot } from "./arc/context-menu/context-menu";
import { MenuRow } from "./MenuRow";
import { LAYER } from "../lib/layers";
import { observeResize } from "../lib/observeResize";
import { popupSizeMinWidth } from "../lib/popover";
import { Popover, popupListClassName, type PopoverAnchor } from "./Popover";
import { PopoverSearchHeader } from "./PopoverSearchHeader";
import { Check, ChevronRight } from "./icons";
import { Badge } from "./Badge";
import { useT } from "../i18n";
import { formatShortcutLabelWith, usePlatform } from "./shortcut";
import {
  actionsOf,
  isField,
  type DropdownMenuAction,
  type DropdownMenuItem,
  type DropdownMenuProps,
  type DropdownMenuSearch,
} from "./dropdownMenuModel";
import styles from "./DropdownMenu.module.css";
import { popupNativeActionMenu } from "./nativeActionMenu";

/**
 * Flat action menu for bounded native windows where a Popover would be clipped.
 * The OS owns the menu chrome. Only a real selection invokes onPick. The returned promise
 * acknowledges opening, and errors reach the caller.
 */
export function popupNativeDropdownMenu(
  anchor: HTMLElement,
  items: readonly Pick<
    DropdownMenuAction,
    "id" | "label" | "description" | "disabled" | "checked"
  >[],
  onPick: (id: string) => void,
): Promise<void> {
  return popupNativeActionMenu(
    anchor,
    items.map(({ id, label, description, disabled, checked }) => ({
      id,
      label: description ? `${label} — ${description}` : label,
      disabled,
      checked,
    })),
    onPick,
  );
}

export type {
  DropdownMenuAction,
  DropdownMenuItem,
  DropdownMenuProps,
  DropdownMenuSearch,
} from "./dropdownMenuModel";

type Controller = {
  /** Reports a picked leaf; closes the whole menu first when `closes`. */
  select: (id: string, closes: boolean) => void;
  close: (restore: boolean) => void;
  closeOnSelect?: boolean;
};

type Branch = { id: string; anchor: HTMLElement; keyboard: boolean };

const SUBMENU_CLOSE_MS = 120;
/** Content-width menus fall back to this minimum until their anchor can be measured. */
const CONTENT_MIN_WIDTH = 228;

function anchorElement(anchor: PopoverAnchor): HTMLElement | null {
  return anchor instanceof HTMLElement
    ? anchor
    : anchor && "current" in anchor
      ? anchor.current
      : null;
}

/**
 * Controlled action menu on Popover: items, groups, separators, radio and checkbox rows, shortcut
 * and badge slots, nested flyouts (`submenu`, any depth) and an optional filter field (`search`).
 * Owns arrow/Home/End/type-ahead keys, ArrowRight/ArrowLeft flyout navigation and focus return to the trigger.
 * Rows close the menu on pick unless `closeOnSelect={false}` (menu or row) keeps it open for multi-toggle lists.
 * The caller owns open state and the anchor; Popover owns placement and dismissal.
 * @group actions
 * @use Commands behind an explicit trigger button, including provider > model > effort cascades, searchable pickers of commands and menus that embed a small form (`content` items, `panel` flyouts).
 * @avoid Right-click menus of plain actions: ContextMenu. Primary action plus alternatives: SplitButton. Choosing a value for a field: Select. Large rich content: Popover.
 */
export function DropdownMenu({
  anchor,
  label,
  items,
  onPick,
  onClose,
  returnFocusRef,
  side = "bottom",
  align = "end",
  size,
  width = size ? popupSizeMinWidth(size) : 228,
  gap,
  maxHeight,
  density,
  frosted,
  closeOnSelect,
  search,
  highlight,
  initialActiveId,
  ignore,
  onEscape,
  ...dataAttributes
}: DropdownMenuProps) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const closed = useRef(false);
  useEffect(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, []);
  const controller: Controller = {
    closeOnSelect,
    close: (restore) => {
      if (closed.current) return;
      closed.current = true;
      if (restore) {
        const target =
          returnFocusRef?.current ??
          (anchor instanceof HTMLElement
            ? anchor
            : anchor && "current" in anchor
              ? anchor.current
              : previousFocus.current);
        if (target?.isConnected) target.focus({ preventScroll: true });
      }
      onClose();
    },
    select: (id, closes) => {
      if (closed.current) return;
      if (closes) controller.close(true);
      onPick(id);
    },
  };
  return (
    <MenuSurface
      {...dataAttributes}
      data-menu-density={density}
      depth={0}
      controller={controller}
      closed={closed}
      anchor={anchor}
      label={label}
      items={items}
      side={side}
      align={align}
      width={width}
      gap={gap}
      maxHeight={maxHeight}
      frosted={frosted}
      search={search}
      highlight={highlight}
      initialActiveId={initialActiveId}
      ignore={ignore}
      onEscape={onEscape}
    />
  );
}

type SurfaceProps = {
  depth: number;
  controller: Controller;
  closed: RefObject<boolean>;
  anchor: PopoverAnchor;
  label: string;
  items: DropdownMenuItem[];
  side: "top" | "bottom" | "left" | "right";
  align: "start" | "center" | "end";
  width: number | "content";
  gap?: number;
  maxHeight?: number;
  frosted?: boolean;
  search?: DropdownMenuSearch;
  highlight?: "focus" | "state";
  initialActiveId?: string;
  ignore?: string;
  onEscape?: () => boolean;
  /** Closes this flyout only; the parent row regains focus. */
  back?: () => void;
  /** Keyboard-opened flyouts take focus; hover-opened ones leave it on the parent row. */
  takeFocus?: boolean;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  [attribute: `data-${string}`]: string | boolean | undefined;
};

function MenuSurface({
  depth,
  controller,
  closed,
  anchor,
  label,
  items,
  side,
  align,
  width,
  gap,
  maxHeight,
  frosted,
  search,
  highlight,
  initialActiveId,
  ignore,
  onEscape,
  back,
  takeFocus,
  onPointerEnter,
  onPointerLeave,
  ...dataAttributes
}: SurfaceProps) {
  const platform = usePlatform();
  const t = useT();
  const takesFocus = takeFocus ?? depth === 0;
  const surface = useRef<HTMLDivElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const openingFocus = useRef<Element | null>(null);
  const query = useRef({ value: "", at: 0 });
  const closeTimer = useRef<number | null>(null);
  const uid = useId();
  const [branch, setBranch] = useState<Branch | null>(null);
  const stateHighlight = Boolean(search) || highlight === "state";
  const [activeId, setActiveId] = useState<string | undefined>(initialActiveId);
  const [contentWidth, setContentWidth] = useState(CONTENT_MIN_WIDTH);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- keeps a content-width menu's minimum width in step with its anchor, measured outside render
  useLayoutEffect(() => {
    const node = width === "content" ? anchorElement(anchor) : null;
    if (!node) return;
    const measure = () => setContentWidth(node.getBoundingClientRect().width);
    measure();
    return observeResize(node, measure);
  }, [anchor, width]);
  const actions = actionsOf(items);
  const enabled = actions.filter((action) => !action.disabled);
  // With a search field or `highlight="state"` the highlight is state (aria-activedescendant);
  // otherwise it is DOM focus.
  const highlighted = stateHighlight
    ? (enabled.find((a) => a.id === activeId) ?? enabled[0])
    : undefined;
  const rowId = (id: string) => `${uid}-${id}`;
  const rows = () =>
    Array.from(
      surface.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ??
        [],
    );
  const rowOf = (id: string) => rows().find((row) => row.dataset.menuId === id);
  // Keyboard moves keep the row inside a scrolling menu; pointer moves never scroll it.
  const focusRow = (row: HTMLElement | undefined) => {
    if (!row) return;
    row.focus({ preventScroll: true });
    row.scrollIntoView?.({ block: "nearest" });
  };
  const cancelClose = () => {
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const scheduleClose = () => {
    cancelClose();
    if (branch) closeTimer.current = window.setTimeout(() => setBranch(null), SUBMENU_CLOSE_MS);
  };
  useEffect(() => cancelClose, []);
  useEffect(() => {
    if (!takesFocus) return;
    openingFocus.current = document.activeElement;
    // A flyout of radio rows opens on the current choice.
    const first = () =>
      (initialActiveId ? rowOf(initialActiveId) : undefined) ??
      (depth > 0 ? rows().find((row) => row.getAttribute("aria-checked") === "true") : undefined) ??
      rows()[0];
    if (!stateHighlight) first()?.focus({ preventScroll: true });
    // Popover measures its first pass with visibility:hidden. Browsers cannot
    // focus that pass, so Popover's autoFocus takes the menu surface as soon as it
    // is placed: a key pressed before the next frame reaches the menu instead of
    // the trigger. The frame then moves to the first row without stealing a row
    // that a key or the pointer already focused.
    const frame = requestAnimationFrame(() => {
      const menu = surface.current;
      const active = document.activeElement;
      if (closed.current || !menu || stateHighlight) return;
      if (active === menu || !menu.contains(active))
        (first() ?? menu).focus({ preventScroll: true });
      first()?.scrollIntoView?.({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (stateHighlight && highlighted) {
      document.getElementById(rowId(highlighted.id))?.scrollIntoView?.({ block: "nearest" });
    }
  }, [highlighted?.id]);
  const openBranch = (action: DropdownMenuAction, row: HTMLElement, keyboard: boolean) => {
    cancelClose();
    setBranch((current) =>
      current?.id !== action.id
        ? { id: action.id, anchor: row, keyboard }
        : keyboard && !current.keyboard
          ? { ...current, keyboard }
          : current,
    );
  };
  const closeBranch = (restoreFocus: boolean) => {
    const current = branch;
    setBranch(null);
    if (!restoreFocus || !current) return;
    if (search) searchField.current?.focus({ preventScroll: true });
    else if (stateHighlight) surface.current?.focus({ preventScroll: true });
    else if (current.anchor.isConnected) current.anchor.focus({ preventScroll: true });
  };
  const activate = (action: DropdownMenuAction, row: HTMLElement | null, keyboard: boolean) => {
    if (action.disabled || closed.current) return;
    if ((action.submenu || action.panel) && row) {
      openBranch(action, row, keyboard);
      return;
    }
    controller.select(
      action.id,
      action.closeOnSelect ??
        controller.closeOnSelect ??
        !(action.selectionRole === "checkbox" && action.checked != null),
    );
  };
  const move = (action: DropdownMenuAction | HTMLElement | undefined) => {
    if (!action) return;
    const id = action instanceof HTMLElement ? action.dataset.menuId : action.id;
    if (branch && branch.id !== id) setBranch(null);
    if (action instanceof HTMLElement && !stateHighlight) focusRow(action);
    else if (id !== undefined) setActiveId(id);
  };
  const step = (key: string, index: number) => {
    const count = stateHighlight ? enabled.length : rows().length;
    if (!count) return undefined;
    const next =
      key === "Home"
        ? 0
        : key === "End"
          ? count - 1
          : key === "ArrowDown"
            ? (index + 1) % count
            : index <= 0
              ? count - 1
              : index - 1;
    return stateHighlight ? enabled[next] : rows()[next];
  };
  const activateHighlight = (key: string) => {
    if (!highlighted) return false;
    if (key === "ArrowRight" && !highlighted.submenu && !highlighted.panel) return false;
    if (key !== "ArrowRight" && key !== "Enter" && key !== " ") return false;
    activate(highlighted, document.getElementById(rowId(highlighted.id)), true);
    return true;
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      event.key === "Process" ||
      event.keyCode === 229
    )
      return;
    const target = event.target as Node;
    // Keys from a flyout bubble here through the React tree; they belong to that flyout.
    if (!surface.current?.contains(target)) return;
    const field = isField(target as Element) && target !== searchField.current;
    const inContent = (target as Element).closest?.("[data-menu-content]") != null;
    if (event.key === "Tab") {
      if (!inContent) controller.close(false);
      return;
    }
    if (target === searchField.current) return;
    if (inContent && !(field && (event.key === "ArrowDown" || event.key === "ArrowUp"))) return;
    const current = stateHighlight
      ? searchIndex()
      : rows().indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowLeft" && depth > 0) {
      event.preventDefault();
      back?.();
      return;
    }
    if (stateHighlight && !field && activateHighlight(event.key)) {
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowRight") {
      const row = (target as Element).closest<HTMLElement>("[data-menu-id]");
      const action = actions.find((a) => a.id === row?.dataset.menuId);
      if (row && action && (action.submenu || action.panel)) {
        event.preventDefault();
        activate(action, row, true);
      }
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      const to = step(event.key, current);
      if (to) {
        event.preventDefault();
        move(to);
      }
      return;
    }
    if (
      event.key.length === 1 &&
      event.key !== " " &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !field
    ) {
      const list = rows();
      const now = performance.now();
      const letter = event.key.toLocaleLowerCase();
      const previous = now - query.current.at < 700 ? query.current.value : "";
      const value =
        previous && [...previous].every((char) => char === letter) ? letter : previous + letter;
      query.current = { value, at: now };
      const ordered = [...list.slice(current + 1), ...list.slice(0, current + 1)];
      const match = ordered.find((row) =>
        row.dataset.menuLabel?.toLocaleLowerCase().startsWith(value),
      );
      if (match) {
        event.preventDefault();
        move(match);
      }
    }
  };
  const searchKeyboard = (event: KeyboardEvent<HTMLInputElement>) => {
    const field = event.currentTarget;
    const row = highlighted ? document.getElementById(rowId(highlighted.id)) : null;
    if (event.key === "ArrowRight" && highlighted && (highlighted.submenu || highlighted.panel)) {
      // The caret keeps its arrow key while it can still move right.
      if (field.selectionStart !== field.value.length) return;
      event.preventDefault();
      activate(highlighted, row, true);
    }
  };
  const searchIndex = () => (highlighted ? enabled.indexOf(highlighted) : -1);

  // One leading icon slot for the whole menu, so rows without an icon keep the label column.
  const hasIcons = actions.some((action) => action.icon != null);
  const renderAction = (item: DropdownMenuAction) => {
    const hasBranch = Boolean(item.submenu || item.panel);
    const isHighlighted = highlighted?.id === item.id;
    return (
      <MenuRow
        key={item.id}
        id={stateHighlight ? rowId(item.id) : undefined}
        type="button"
        role={
          item.checked == null
            ? "menuitem"
            : item.selectionRole === "radio"
              ? "menuitemradio"
              : "menuitemcheckbox"
        }
        aria-checked={item.checked}
        aria-label={item.label}
        aria-description={item.description}
        aria-haspopup={hasBranch ? "menu" : undefined}
        aria-expanded={hasBranch ? branch?.id === item.id : undefined}
        disabled={item.disabled}
        title={item.title}
        destructive={item.danger}
        data-menu-id={item.id}
        data-menu-label={item.label}
        data-highlighted={isHighlighted ? "true" : undefined}
        data-described={item.description ? "true" : undefined}
        tabIndex={-1}
        branchWidth={item.submenuWidth}
        // The search field (or the menu surface, in state highlight) keeps focus: a press on a row
        // must not pull it away.
        onMouseDown={stateHighlight ? (event) => event.preventDefault() : undefined}
        onPointerMove={(event) => {
          if (item.disabled) return;
          const row = event.currentTarget;
          if (hasBranch) openBranch(item, row, false);
          else if (branch) scheduleClose();
          if (stateHighlight) setActiveId(item.id);
          else if (!isField(document.activeElement) && document.activeElement !== row) {
            row.focus({ preventScroll: true });
          }
        }}
        onClick={(event) => activate(item, event.currentTarget, event.detail === 0)}
      >
        {hasIcons ? (
          <span className={slot.icon} aria-hidden="true">
            {item.icon}
          </span>
        ) : null}
        {item.content ?? (
          <span className={slot.copy}>
            <span className={slot.label}>
              <span>{item.label}</span>
              {item.badge ? <Badge size="sm">{item.badge}</Badge> : null}
            </span>
            {item.description ? <span className={slot.description}>{item.description}</span> : null}
          </span>
        )}
        {item.trailing}
        {item.checked != null ? (
          <span className={slot.trailing} aria-hidden="true">
            {item.checked ? <Check /> : null}
          </span>
        ) : item.shortcut ? (
          <span className={`${slot.trailing} ${slot.shortcut}`} aria-hidden="true">
            {/* The one shortcut formatter: platform spelling, sequences and alternatives kept. */}
            {formatShortcutLabelWith(item.shortcut, platform, t).text || item.shortcut}
          </span>
        ) : null}
        {hasBranch ? (
          <ChevronRight
            data-branch-indicator
            className={`icon-sm shrink-0 ${slot.trailing}`}
            strokeWidth={1.75}
          />
        ) : null}
      </MenuRow>
    );
  };
  const open = branch ? actions.find((action) => action.id === branch.id) : undefined;
  const rowsMarkup = items.map((item, index) =>
    item.kind === "sep" ? (
      <div role="separator" key={`sep-${index}`} className={slot.separator} />
    ) : item.kind === "content" ? (
      <div key={item.id} data-menu-content className={styles.content}>
        {item.node}
      </div>
    ) : item.kind === "group" ? (
      item.items.length ? (
        <div key={item.id} role="group" aria-label={item.label} className={styles.group}>
          <div className={slot.heading} aria-hidden="true">
            {item.label}
          </div>
          {item.items.map(renderAction)}
        </div>
      ) : null
    ) : (
      renderAction(item)
    ),
  );
  const flyout =
    open && branch ? (
      open.panel ? (
        <Popover
          key={`${open.id}:panel:${branch.keyboard}`}
          anchor={branch.anchor}
          side="right"
          align="start"
          gap={4}
          width={open.submenuWidth ?? 296}
          kind="dialog"
          autoFocus={branch.keyboard}
          aria-label={open.submenuLabel ?? open.label}
          layer={LAYER.submenu + depth}
          onDismiss={(reason) => {
            if (reason === "escape") closeBranch(true);
          }}
          onPointerEnter={cancelClose}
          className={`bycoda-arc ${styles.panel}`}
        >
          {open.panel}
        </Popover>
      ) : (
        <MenuSurface
          key={`${open.id}:${branch.keyboard}`}
          depth={depth + 1}
          controller={controller}
          closed={closed}
          anchor={branch.anchor}
          label={open.submenuLabel ?? open.label}
          items={open.submenu ?? []}
          side="right"
          align="start"
          width={open.submenuWidth ?? 228}
          gap={2}
          maxHeight={open.submenuMaxHeight}
          takeFocus={branch.keyboard}
          back={() => closeBranch(true)}
          onPointerEnter={cancelClose}
          onPointerLeave={scheduleClose}
        />
      )
    ) : null;
  // The opening control can still own focus while Popover measures its hidden frame.
  // Once the menu receives focus, its own handler and active-descendant relationship take over.
  useEffect(() => {
    if (highlight !== "state" || search || !takesFocus) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      const active = document.activeElement;
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        closed.current ||
        !active ||
        active !== openingFocus.current ||
        surface.current?.contains(active) ||
        (event.target !== active && event.target !== window)
      )
        return;
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        move(step(event.key, searchIndex()));
        return;
      }
      if (activateHighlight(event.key)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  return (
    <Popover
      {...dataAttributes}
      ref={surface}
      anchor={anchor}
      role="menu"
      aria-label={label}
      aria-activedescendant={
        highlight === "state" && !search && highlighted ? rowId(highlighted.id) : undefined
      }
      tabIndex={-1}
      autoFocus={takesFocus}
      side={side}
      align={align}
      minWidth={width === "content" ? contentWidth : width}
      gap={gap}
      maxHeight={maxHeight}
      frosted={frosted}
      layer={depth ? LAYER.submenu + depth - 1 : undefined}
      ignore={ignore}
      onContextMenu={(event) => event.preventDefault()}
      onDismiss={(reason) => {
        if (depth > 0) {
          if (reason === "escape") back?.();
          return;
        }
        if (reason === "escape" && onEscape?.()) return;
        controller.close(reason === "escape");
      }}
      onKeyDown={keyboard}
      onFocus={() => {
        openingFocus.current = null;
      }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave ?? (branch ? scheduleClose : undefined)}
      className={`bycoda-arc ${styles.menu} ${search ? styles.searchable : popupListClassName}`}
    >
      {search ? (
        <>
          <PopoverSearchHeader
            ref={searchField}
            label={search.label}
            placeholder={search.placeholder}
            value={search.value}
            onValueChange={(value) => {
              search.onChange(value);
              setActiveId(undefined);
              setBranch(null);
            }}
            listId={`${uid}-rows`}
            activeOptionId={highlighted ? rowId(highlighted.id) : undefined}
            onKeyDown={searchKeyboard}
            onMove={(direction) => {
              const to =
                enabled[
                  (searchIndex() + (direction === "next" ? 1 : -1) + enabled.length) %
                    enabled.length
                ];
              if (to) move(to);
            }}
            onSubmit={() => {
              if (!highlighted) return;
              activate(highlighted, document.getElementById(rowId(highlighted.id)), true);
            }}
          />
          <div id={`${uid}-rows`} className={`${styles.body} ${popupListClassName}`}>
            {rowsMarkup}
          </div>
        </>
      ) : (
        rowsMarkup
      )}
      {flyout}
    </Popover>
  );
}
