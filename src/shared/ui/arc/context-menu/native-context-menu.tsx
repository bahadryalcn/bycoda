import { TextField } from "../../TextField";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { LAYER } from "../../../lib/layers";
import { Check, ChevronRight } from "../../icons";
import { Popover } from "../../Popover";
import {
  contextMenuDestructiveClassName,
  contextMenuRowClassName,
  contextMenuSlotClassName as slot,
} from "./context-menu";

type MenuAction = {
  icon?: ReactNode;
  kind: "item";
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  /** Native tooltip, useful to explain why an item is disabled. */
  title?: string;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
};

type MenuSeparator = { kind: "sep" };

export type ContextMenuItem =
  | MenuSeparator
  | (MenuAction & {
      submenu?: (MenuAction | MenuSeparator)[];
      submenuSearch?: { placeholder: string; emptyLabel: string };
    });

export type ContextMenuProps = (
  | { x: number; y: number; anchor?: never }
  | { anchor: HTMLElement; x?: never; y?: never }
) & {
  ownerId?: string;
  onBack?: () => void;
  items: ContextMenuItem[];
  ariaLabel?: string;
  header?: ReactNode;
  width?: number;
  /** Placement and styling overrides for compact tool menus. */
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  className?: string;
  rowClassName?: string;
  onPick: (id: string) => void;
  onClose: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
};

const MENU_WIDTH = 228;

/** First enabled action at or after `start`; the keyboard never highlights a disabled row. */
function itemIndexAt(items: ContextMenuItem[], start: number, dir: 1 | -1): number {
  let i = start;
  while (i >= 0 && i < items.length) {
    const item = items[i];
    if (item?.kind === "item" && !item.disabled) return i;
    i += dir;
  }
  const first = items.findIndex((item) => item.kind === "item");
  return first < 0 ? 0 : first;
}

export function NativeContextMenu({
  x,
  y,
  anchor,
  ownerId,
  onBack,
  items,
  ariaLabel = "File actions",
  header,
  width = MENU_WIDTH,
  side,
  align,
  className,
  rowClassName,
  onPick,
  onClose,
  onMouseEnter,
  onMouseLeave,
}: ContextMenuProps) {
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [active, setActive] = useState(() => itemIndexAt(items, 0, 1));
  // One leading icon slot per menu level, so rows without an icon keep the label column.
  const mainHasIcons = items.some((item) => item.kind === "item" && item.icon != null);
  const [submenu, setSubmenu] = useState<{
    index: number;
    anchor: HTMLButtonElement;
  } | null>(null);
  const [submenuActive, setSubmenuActive] = useState(-1);
  const [submenuQuery, setSubmenuQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const submenuItem = submenu ? items[submenu.index] : undefined;
  const submenuSearch = submenuItem?.kind === "item" ? submenuItem.submenuSearch : undefined;
  // The submenu query belongs to the submenu (and search field) it was typed in; adjusted during render.
  const submenuQueryKey = `${submenu?.index ?? ""}:${submenuSearch?.placeholder ?? ""}`;
  const [queryOwner, setQueryOwner] = useState(submenuQueryKey);
  if (queryOwner !== submenuQueryKey) {
    setQueryOwner(submenuQueryKey);
    setSubmenuQuery("");
  }
  const submenuItems =
    submenuItem?.kind === "item"
      ? submenuItem.submenu?.filter(
          (item) =>
            !submenuSearch ||
            !submenuQuery.trim() ||
            (item.kind === "item" &&
              item.label.toLocaleLowerCase().includes(submenuQuery.trim().toLocaleLowerCase())),
        )
      : undefined;

  const submenuHasIcons = !!submenuItems?.some((item) => item.kind === "item" && item.icon != null);

  useEffect(() => {
    if (submenuSearch) searchRef.current?.focus({ preventScroll: true });
  }, [submenu?.index, submenuSearch?.placeholder]);

  useEffect(() => {
    if (submenuActive >= 0) {
      submenuRef.current
        ?.querySelector(`[data-menu-index="${submenuActive}"]`)
        ?.scrollIntoView?.({ block: "nearest" });
    }
  }, [submenuActive]);

  const cancelClose = () => {
    if (closeTimer.current != null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  const closeSubmenu = () => {
    cancelClose();
    if (submenuRef.current?.contains(document.activeElement)) {
      menuRef.current?.focus({ preventScroll: true });
    }
    setSubmenu(null);
    setSubmenuActive(-1);
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(closeSubmenu, 180);
  };

  useEffect(() => cancelClose, []);

  const ids = useMemo(
    () =>
      items.flatMap((item, index) =>
        item.kind === "item" ? [{ index, id: item.id, disabled: !!item.disabled }] : [],
      ),
    [items],
  );

  // Only keyboard moves scroll the highlighted row into view; hovering never shifts the list.
  const keyboardMove = useRef(false);
  useEffect(() => {
    if (!keyboardMove.current) return;
    keyboardMove.current = false;
    menuRef.current
      ?.querySelector(`[data-menu-index="${active}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const move = (dir: 1 | -1) => {
    keyboardMove.current = true;
    const enabled = ids.filter((item) => !item.disabled);
    if (!enabled.length) return;
    const from = enabled.findIndex((item) => item.index === active);
    const next =
      from < 0
        ? enabled[dir === 1 ? 0 : enabled.length - 1]
        : enabled[(from + dir + enabled.length) % enabled.length];
    if (next) setActive(next.index);
  };
  const edge = (end: boolean) => {
    keyboardMove.current = true;
    const enabled = ids.filter((item) => !item.disabled);
    const next = enabled[end ? enabled.length - 1 : 0];
    if (next) setActive(next.index);
  };

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Text editing retains spaces and caret navigation; up/down selects results.
    if (e.target === searchRef.current && !["ArrowDown", "ArrowUp", "Enter"].includes(e.key))
      return;
    if (e.key === "ArrowLeft" && !submenuItems && onBack) {
      e.preventDefault();
      e.stopPropagation();
      onBack();
      return;
    }
    if (submenuItems) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        closeSubmenu();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const direction = e.key === "ArrowDown" ? 1 : -1;
        setSubmenuActive((current) => {
          // Step over separators; the list always has at least one item.
          let next = current;
          for (let step = 0; step < submenuItems.length; step += 1) {
            next =
              next < 0
                ? direction === 1
                  ? 0
                  : submenuItems.length - 1
                : (next + direction + submenuItems.length) % submenuItems.length;
            const candidate = submenuItems[next];
            if (candidate?.kind === "item" && !candidate.disabled) return next;
          }
          return current;
        });
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const enabled = submenuItems
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.kind === "item" && !item.disabled);
        const target = enabled[e.key === "Home" ? 0 : enabled.length - 1];
        if (target) setSubmenuActive(target.index);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const item = submenuItems[submenuActive];
        if (item?.kind === "item" && !item.disabled) onPick(item.id);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      edge(e.key === "End");
      return;
    }
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") {
      e.preventDefault();
      const item = items[active];
      if (item?.kind !== "item" || item.disabled) return;
      if (item.submenu?.length) {
        const anchor = menuRef.current?.querySelector<HTMLButtonElement>(
          `[data-menu-index="${active}"]`,
        );
        if (anchor) {
          cancelClose();
          setSubmenu({ index: active, anchor });
          setSubmenuActive(0);
        }
      } else if (e.key !== "ArrowRight") {
        onPick(item.id);
      }
    }
  };

  const renderItem = (
    item: MenuAction & {
      submenu?: unknown[];
      submenuSearch?: { placeholder: string; emptyLabel: string };
    },
    index: number,
    inSubmenu = false,
    reserveIcon = false,
  ) => {
    const highlighted = index === (inSubmenu ? submenuActive : active);
    const hasSubmenu = !!item.submenu?.length;
    return (
      <button
        key={item.id}
        id={`${menuId}-${inSubmenu ? "sub-" : ""}${index}`}
        data-menu-index={index}
        data-highlighted={highlighted || undefined}
        data-danger={item.danger || undefined}
        data-described={item.description ? "true" : undefined}
        type="button"
        role={item.checked == null ? "menuitem" : "menuitemcheckbox"}
        tabIndex={-1}
        aria-checked={item.checked}
        aria-label={item.description ? item.label : undefined}
        aria-description={item.description}
        aria-haspopup={hasSubmenu ? "menu" : undefined}
        aria-expanded={hasSubmenu ? submenu?.index === index : undefined}
        aria-controls={hasSubmenu && submenu?.index === index ? `${menuId}-submenu` : undefined}
        disabled={item.disabled}
        title={item.title}
        onMouseDown={(e) => e.preventDefault()}
        onMouseEnter={(e) => {
          cancelClose();
          keyboardMove.current = false;
          if (inSubmenu) {
            setSubmenuActive(index);
            if (!submenuSearch) submenuRef.current?.focus({ preventScroll: true });
            return;
          }
          setActive(index);
          if (hasSubmenu && !item.disabled) {
            if (submenu?.index !== index) setSubmenuQuery("");
            setSubmenu({ index, anchor: e.currentTarget });
            setSubmenuActive(-1);
          } else {
            closeSubmenu();
          }
        }}
        onClick={(e) => {
          if (item.disabled) return;
          if (hasSubmenu) {
            cancelClose();
            setSubmenu({ index, anchor: e.currentTarget });
            setSubmenuActive(0);
            if (item.submenuSearch) searchRef.current?.focus({ preventScroll: true });
            else submenuRef.current?.focus({ preventScroll: true });
          } else {
            onPick(item.id);
          }
        }}
        className={[
          "bycoda-arc",
          contextMenuRowClassName,
          item.danger ? contextMenuDestructiveClassName : "",
          rowClassName ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {item.icon || reserveIcon ? (
          <span className={slot.icon} aria-hidden="true">
            {item.icon}
          </span>
        ) : null}
        <span className={slot.copy}>
          <span className={slot.label}>{item.label}</span>
          {item.description ? <span className={slot.description}>{item.description}</span> : null}
        </span>
        {hasSubmenu ? (
          <span className={slot.trailing} aria-hidden="true">
            <ChevronRight data-branch-indicator strokeWidth={1.75} />
          </span>
        ) : item.checked ? (
          <span className={slot.trailing} aria-hidden="true">
            <Check strokeWidth={2.25} />
          </span>
        ) : item.shortcut ? (
          <span className={`${slot.trailing} ${slot.shortcut}`} aria-hidden="true">
            {item.shortcut}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <>
      <Popover
        ref={menuRef}
        anchor={anchor ?? { x: x ?? 0, y: y ?? 0 }}
        side={side ?? (anchor ? "right" : undefined)}
        align={align}
        gap={anchor ? 4 : 0}
        layer={anchor ? LAYER.submenu : undefined}
        data-menu-owner={ownerId}
        width={width}
        autoFocus
        onDismiss={(reason) => {
          if (reason === "escape" && submenu) closeSubmenu();
          else onClose();
        }}
        ignore={`[data-explorer-menu="${menuId}"]`}
        data-explorer-menu={menuId}
        role="menu"
        tabIndex={-1}
        aria-label={ariaLabel}
        aria-activedescendant={`${menuId}-${active}`}
        onKeyDown={onMenuKey}
        onContextMenu={(e) => e.preventDefault()}
        onMouseEnter={() => {
          cancelClose();
          onMouseEnter?.();
        }}
        onMouseLeave={() => {
          if (submenu) scheduleClose();
          onMouseLeave?.();
        }}
        className={`overflow-y-auto overscroll-none p-1 ${className ?? ""}`}
      >
        {header ? (
          <>
            {header}
            <div role="separator" className={slot.separator} />
          </>
        ) : null}
        {items.map((item, index) => {
          if (item.kind === "sep") {
            return <div key={`sep-${index}`} role="separator" className={slot.separator} />;
          }
          return renderItem(item, index, false, mainHasIcons);
        })}
      </Popover>
      {submenu && submenuItems && submenuItem?.kind === "item" ? (
        <Popover
          ref={submenuRef}
          id={`${menuId}-submenu`}
          anchor={submenu.anchor}
          side="right"
          gap={4}
          width={MENU_WIDTH}
          layer={LAYER.submenu}
          autoFocus
          onFocus={(event) => {
            if (submenuSearch && event.target === event.currentTarget)
              searchRef.current?.focus({ preventScroll: true });
          }}
          role="menu"
          tabIndex={-1}
          aria-label={submenuItem.label}
          aria-activedescendant={submenuActive >= 0 ? `${menuId}-sub-${submenuActive}` : undefined}
          data-explorer-menu={menuId}
          data-menu-owner={ownerId}
          onDismiss={(reason) => {
            if (reason === "escape") closeSubmenu();
            else onClose();
          }}
          onKeyDown={onMenuKey}
          onContextMenu={(e) => e.preventDefault()}
          onMouseEnter={() => {
            cancelClose();
            onMouseEnter?.();
          }}
          onMouseLeave={() => {
            scheduleClose();
            onMouseLeave?.();
          }}
          className="overflow-y-auto overscroll-none p-1"
        >
          {submenuSearch ? (
            <div className="sticky top-0 z-10 bg-(--ui-surface-floating) pb-1">
              <TextField
                ref={searchRef}
                label={submenuSearch.placeholder}
                hideLabel
                value={submenuQuery}
                placeholder={submenuSearch.placeholder}
                aria-label={submenuSearch.placeholder}
                onChange={(event) => {
                  setSubmenuQuery(event.target.value);
                  setSubmenuActive(-1);
                }}
              />
            </div>
          ) : null}
          {submenuItems.length === 0 && submenuSearch ? (
            <div role="status" className="p-2 text-[var(--ui-text-secondary)]">
              {submenuSearch.emptyLabel}
            </div>
          ) : null}
          {submenuItems.map((item, index) =>
            item.kind === "sep" ? (
              <div key={`sep-${index}`} role="separator" className={slot.separator} />
            ) : (
              renderItem(item, index, true, submenuHasIcons)
            ),
          )}
        </Popover>
      ) : null}
    </>
  );
}
