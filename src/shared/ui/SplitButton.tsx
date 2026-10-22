import { useRef, useState, type Ref, type ReactNode } from "react";
import { Button, type ButtonProps } from "./Button";
import { DropdownMenu } from "./DropdownMenu";
import { ChevronDown } from "./icons";
import styles from "./SplitButton.module.css";

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
  menuLabel: string;
  actions: readonly SplitButtonAction[];
  groupRef?: Ref<HTMLDivElement>;
  menuOpen?: boolean;
  /** Independent menu gate, for choices that remain available while the primary action is disabled. Loading and aria-disabled always block both. */
  menuDisabled?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
};

/** Arc split-button composition with bycoda's action, motion and overlay owners. */
export function SplitButton({
  label,
  menuLabel,
  actions,
  groupRef,
  menuOpen,
  menuDisabled,
  onMenuOpenChange,
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
  return (
    <div
      ref={groupRef}
      role="group"
      aria-label={label}
      className={[styles.group, buttonProps.fullWidth ? styles.fullWidth : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <Button {...buttonProps} disabled={disabled} loading={loading}>
        {label}
      </Button>
      <Button
        variant={buttonProps.variant}
        tone={buttonProps.tone}
        size={buttonProps.size}
        shape={buttonProps.shape}
        type="button"
        ref={trigger}
        iconOnly
        label={menuLabel}
        tooltip={menuLabel}
        disabled={blocked || !actions.length}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => changeOpen(!open)}
      >
        <ChevronDown className="size-3.5" />
      </Button>
      {open && !blocked ? (
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
