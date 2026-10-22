import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { ContextMenuRow } from "./arc/context-menu/context-menu";
import { Popover, type PopoverAnchor } from "./Popover";
import { Check } from "./icons";
import styles from "./DropdownMenu.module.css";

export type DropdownMenuItem =
  | { kind: "sep" }
  | {
      kind: "item";
      id: string;
      label: string;
      icon?: ReactNode;
      description?: string;
      shortcut?: string;
      title?: string;
      disabled?: boolean;
      danger?: boolean;
      checked?: boolean;
      selectionRole?: "radio" | "checkbox";
    };

export interface DropdownMenuProps {
  anchor: PopoverAnchor;
  label: string;
  items: DropdownMenuItem[];
  onPick: (id: string) => void;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  width?: number;
}

/** A controlled, single-level action menu. Popover owns placement and dismissal. */
export function DropdownMenu({
  anchor,
  label,
  items,
  onPick,
  onClose,
  returnFocusRef,
  side = "bottom",
  align = "end",
  width = 228,
}: DropdownMenuProps) {
  const surface = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const closed = useRef(false);
  const query = useRef({ value: "", at: 0 });
  const rows = () =>
    Array.from(
      surface.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ??
        [],
    );
  const close = (restore: boolean) => {
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
  };
  useEffect(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    rows()[0]?.focus({ preventScroll: true });
    // Popover measures its first pass with visibility:hidden. Browsers cannot
    // focus that pass; retry after placement without stealing an existing row focus.
    const frame = requestAnimationFrame(() => {
      if (!closed.current && surface.current && !surface.current.contains(document.activeElement)) {
        (rows()[0] ?? surface.current).focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.key === "Process" || event.keyCode === 229) return;
    const enabled = rows();
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | undefined;
    if (event.key === "ArrowDown") next = (current + 1) % enabled.length;
    else if (event.key === "ArrowUp") next = current <= 0 ? enabled.length - 1 : current - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = enabled.length - 1;
    else if (event.key === "Tab") {
      close(false);
      return;
    } else if (
      event.key.length === 1 &&
      event.key !== " " &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      const now = performance.now();
      const letter = event.key.toLocaleLowerCase();
      const previous = now - query.current.at < 700 ? query.current.value : "";
      const value =
        previous && [...previous].every((char) => char === letter) ? letter : previous + letter;
      query.current = { value, at: now };
      const ordered = [...enabled.slice(current + 1), ...enabled.slice(0, current + 1)];
      const match = ordered.find((row) =>
        row.dataset.menuLabel?.toLocaleLowerCase().startsWith(value),
      );
      if (match) {
        event.preventDefault();
        match.focus({ preventScroll: true });
      }
      return;
    }
    if (next !== undefined && enabled.length) {
      event.preventDefault();
      enabled[next]?.focus({ preventScroll: true });
    }
  };
  return (
    <Popover
      ref={surface}
      anchor={anchor}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      side={side}
      align={align}
      width={width}
      onDismiss={(reason) => close(reason === "escape")}
      onKeyDown={keyboard}
      className={`bycoda-arc ${styles.menu}`}
    >
      {items.map((item, index) =>
        item.kind === "sep" ? (
          <div role="separator" key={`sep-${index}`} className={styles.separator} />
        ) : (
          <ContextMenuRow
            key={item.id}
            type="button"
            role={item.checked == null ? "menuitem" : item.selectionRole === "radio" ? "menuitemradio" : "menuitemcheckbox"}
            aria-checked={item.checked}
            aria-label={item.label}
            aria-description={item.description}
            disabled={item.disabled}
            title={item.title}
            destructive={item.danger}
            data-menu-label={item.label}
            tabIndex={-1}
            onPointerMove={(event) => {
              if (!item.disabled) event.currentTarget.focus({ preventScroll: true });
            }}
            onClick={() => {
              if (item.disabled || closed.current) return;
              close(true);
              onPick(item.id);
            }}
          >
            {item.icon ? (
              <span className={styles.icon} aria-hidden="true">
                {item.icon}
              </span>
            ) : null}
            <span className={styles.copy}>
              <span>{item.label}</span>
              {item.description ? (
                <span className={styles.description}>{item.description}</span>
              ) : null}
            </span>
            {item.checked ? (
              <Check className={styles.icon} aria-hidden="true" />
            ) : item.shortcut ? (
              <span className={styles.shortcut} aria-hidden="true">
                {item.shortcut}
              </span>
            ) : null}
          </ContextMenuRow>
        ),
      )}
    </Popover>
  );
}
