import { Button } from "../../Button";
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
  | (MenuAction & { submenu?: (MenuAction | MenuSeparator)[] });

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

function itemIndexAt(items: ContextMenuItem[], start: number, dir: 1 | -1): number {
  let i = start;
  while (i >= 0 && i < items.length) {
    const item = items[i];
    if (item?.kind === "item") return i;
    i += dir;
  }
  return start;
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
  const [submenu, setSubmenu] = useState<{
    index: number;
    anchor: HTMLButtonElement;
  } | null>(null);
  const [submenuActive, setSubmenuActive] = useState(-1);
  const submenuItem = submenu ? items[submenu.index] : undefined;
  const submenuItems = submenuItem?.kind === "item" ? submenuItem.submenu : undefined;

  const cancelClose = () => {
    if (closeTimer.current != null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  const closeSubmenu = () => {
    cancelClose();
    if (submenuRef.current?.contains(document.activeElement)) {
      menuRef.current?.focus();
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

  const move = (dir: 1 | -1) => {
    const from = ids.findIndex((item) => item.index === active);
    const next = ids[(from + dir + ids.length) % ids.length];
    if (next) setActive(next.index);
  };

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
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
            if (submenuItems[next]?.kind === "item") return next;
          }
          return current;
        });
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
    item: MenuAction & { submenu?: unknown[] },
    index: number,
    inSubmenu = false,
  ) => {
    const highlighted = index === (inSubmenu ? submenuActive : active);
    const hasSubmenu = !!item.submenu?.length;
    return (
      <Button
        variant="item"
        selected={highlighted}
        motion="none"
        key={item.id}
        id={`${menuId}-${inSubmenu ? "sub-" : ""}${index}`}
        data-menu-index={index}
        data-highlighted={highlighted || undefined}
        data-danger={item.danger || undefined}
        type="button"
        role={item.checked == null ? "menuitem" : "menuitemcheckbox"}
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
          if (inSubmenu) {
            setSubmenuActive(index);
            submenuRef.current?.focus();
            return;
          }
          setActive(index);
          if (hasSubmenu && !item.disabled) {
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
            submenuRef.current?.focus();
          } else {
            onPick(item.id);
          }
        }}
        className={`   ${rowClassName ?? ""}  flex  ${item.description ? "" : "h-7"}  w-full items-center gap-3 text-left  ${
          item.disabled ? "" : item.danger ? (highlighted ? "" : "") : highlighted ? "" : ""
        }   `}
      >
        {item.icon ? (
          <span className="flex size-4 shrink-0 items-center justify-center">{item.icon}</span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate leading-[var(--leading-body)]">{item.label}</span>
          {item.description ? (
            <span className="mt-1 block text-[11px] leading-snug text-[var(--ui-text-secondary)]">
              {item.description}
            </span>
          ) : null}
        </span>
        {hasSubmenu ? (
          <ChevronRight
            className="size-3.5 shrink-0 text-[var(--ui-text-secondary)]"
            strokeWidth={1.75}
          />
        ) : item.checked ? (
          <Check className="size-3.5 shrink-0" strokeWidth={2.25} />
        ) : item.shortcut ? (
          <span className="shrink-0 text-[11px] text-[var(--ui-text-muted)]">{item.shortcut}</span>
        ) : null}
      </Button>
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
            <div role="separator" className="my-1 h-px bg-[var(--ui-surface-muted)]" />
          </>
        ) : null}
        {items.map((item, index) => {
          if (item.kind === "sep") {
            return (
              <div
                key={`sep-${index}`}
                role="separator"
                className="my-1 h-px bg-[var(--ui-surface-muted)]"
              />
            );
          }
          return renderItem(item, index);
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
          {submenuItems.map((item, index) =>
            item.kind === "sep" ? (
              <div
                key={`sep-${index}`}
                role="separator"
                className="my-1 h-px bg-[var(--ui-surface-muted)]"
              />
            ) : (
              renderItem(item, index, true)
            ),
          )}
        </Popover>
      ) : null}
    </>
  );
}
