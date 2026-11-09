import { useEffect, useLayoutEffect, useRef, useState, type Ref, type ReactNode } from "react";
import { Button, type ButtonProps } from "./Button";
import { DropdownMenu } from "./DropdownMenu";
import { ChevronDown } from "./icons";
import styles from "./SplitButton.module.css";
import { popupNativeActionMenu } from "./nativeActionMenu";

export interface SplitButtonAction {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
  checked?: boolean;
  selectionRole?: "radio" | "checkbox";
  danger?: boolean;
  onSelect: () => void;
}
export type SplitButtonProps = Omit<ButtonProps, "children" | "iconOnly" | "label"> & {
  label: string;
  /** Fixed-size content after the label (counts, badges). The label truncates first. */
  trailing?: ReactNode;
  menuLabel: string;
  actions: readonly SplitButtonAction[];
  groupRef?: Ref<HTMLDivElement>;
  menuOpen?: boolean;
  /** Independent menu gate, for choices that remain available while the primary action is disabled. Loading and aria-disabled always block both. */
  menuDisabled?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
  /** Native menus can escape a small native webview. Popover remains the default. */
  menuSurface?: "popover" | "native";
  /** A native popup failure is not a choice; the owning surface supplies recovery. */
  onMenuError?: (cause: unknown) => void;
};

/**
 * A primary action Button joined to a menu of explicit alternatives (`actions`, with checked/danger/description).
 * `menuDisabled` keeps the menu reachable while the primary is disabled; loading blocks both. `menuSurface="native"` for small native windows.
 * Choosing a menu item runs its `onSelect`; it never changes the primary action.
 * @group actions
 * @use One default action plus a few related variants (Commit / Amend, Merge methods).
 * @avoid Commands with no default: DropdownMenu on a Button. Joined independent buttons: ButtonGroup.
 */
export function SplitButton({
  label,
  trailing,
  menuLabel,
  actions,
  groupRef,
  menuOpen,
  menuDisabled,
  onMenuOpenChange,
  menuSurface = "popover",
  onMenuError,
  disabled,
  loading,
  ...buttonProps
}: SplitButtonProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const open = menuOpen ?? internalOpen;
  const blocked = Boolean(
    (menuDisabled ?? disabled) ||
    loading ||
    buttonProps["aria-disabled"] === true ||
    buttonProps["aria-disabled"] === "true",
  );
  const changeOpen = (next: boolean) => {
    if (menuOpen === undefined) setInternalOpen(next);
    onMenuOpenChange?.(next);
  };
  const latestMenu = useRef({ actions, blocked, changeOpen, onMenuError });
  useLayoutEffect(() => {
    latestMenu.current = { actions, blocked, changeOpen, onMenuError };
  });
  useEffect(() => {
    const anchor = trigger.current;
    if (!open || blocked || menuSurface !== "native" || !anchor) return;
    let retired = false;
    void popupNativeActionMenu(anchor, actions, (id) => {
      const current = latestMenu.current;
      const action = current.actions.find((entry) => entry.id === id);
      if (!anchor.isConnected || current.blocked || !action || action.disabled) return;
      action.onSelect();
    })
      .catch((cause) => {
        if (!retired && anchor.isConnected) latestMenu.current.onMenuError?.(cause);
      })
      .finally(() => {
        // Native popup acceptance is not selection or dismissal. The native menu
        // owns its lifetime; this only retires our one display request.
        if (!retired) latestMenu.current.changeOpen(false);
      });
    return () => {
      retired = true;
    };
  }, [open, blocked, menuSurface]);
  // Solid actions separate with a gap, outlined ones share a border, quiet ones need no seam.
  const hierarchy = buttonProps.variant ?? "secondary";
  const seam =
    hierarchy === "primary"
      ? "gap"
      : hierarchy === "secondary" || hierarchy === "danger"
        ? "shared"
        : "none";
  return (
    <div
      ref={groupRef}
      role="group"
      aria-label={label}
      data-split-seam={seam}
      className={[styles.group, buttonProps.fullWidth ? styles.fullWidth : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <Button {...buttonProps} data-split-part="primary" disabled={disabled} loading={loading}>
        {trailing ? (
          <>
            <span className="min-w-0 truncate">{label}</span>
            {trailing}
          </>
        ) : (
          label
        )}
      </Button>
      {/* A disabled solid primary must not leave a bright solid chevron beside it. */}
      <Button
        variant={disabled && hierarchy === "primary" ? "secondary" : buttonProps.variant}
        tone={buttonProps.tone}
        size={buttonProps.size}
        shape={buttonProps.shape}
        type="button"
        data-split-part="menu"
        ref={trigger}
        iconOnly
        label={menuLabel}
        tooltip={menuLabel}
        disabled={blocked || !actions.length}
        aria-haspopup="menu"
        aria-expanded={menuSurface === "native" ? undefined : open}
        onClick={() => changeOpen(!open)}
      >
        <ChevronDown className="size-3.5" />
      </Button>
      {open && !blocked && menuSurface === "popover" ? (
        <DropdownMenu
          anchor={trigger}
          label={menuLabel}
          onClose={() => changeOpen(false)}
          items={actions.map(
            ({ id, label, description, icon, disabled, checked, selectionRole, danger }) => ({
              kind: "item",
              id,
              label,
              description,
              icon,
              disabled,
              checked,
              selectionRole,
              danger,
            }),
          )}
          onPick={(id) => {
            const action = actions.find((item) => item.id === id);
            if (!blocked && action && !action.disabled) action.onSelect();
          }}
        />
      ) : null}
    </div>
  );
}
