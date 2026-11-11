import { useRef, useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuItem } from "../../../../shared/ui/DropdownMenu";
import { Heading } from "../../../../shared/ui/Heading";
import { MoreHorizontal } from "../../../../shared/ui/icons";
import { DisabledReason, gateProps, type ActionGate } from "./DisabledReason";
import "./common.css";

export type ScreenHeaderMenuItem = {
  id: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};

export type ScreenHeaderProps = {
  title: string;
  description?: string;
  /** The one primary action of the screen. */
  primary?: { label: string; onClick: () => void } & ActionGate;
  /** Secondary actions. They live in one overflow menu, never beside the primary action. */
  secondary?: ScreenHeaderMenuItem[];
};

/** Screen title, one primary action and an overflow menu for everything else. */
export function ScreenHeader({ title, description, primary, secondary = [] }: ScreenHeaderProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const items: DropdownMenuItem[] = secondary.map((item) => ({
    kind: "item",
    id: item.id,
    label: item.label,
    danger: item.danger,
    disabled: item.disabled,
  }));
  const pick = (id: string) => {
    setOpen(false);
    secondary.find((item) => item.id === id)?.onSelect();
  };
  return (
    <header className="social-screen-header">
      <div className="social-screen-heading">
        <Heading size="page" level={2}>
          {title}
        </Heading>
        {description ? <p className="social-screen-description">{description}</p> : null}
      </div>
      <div className="social-screen-actions">
        {primary ? (
          <DisabledReason
            variant="primary"
            size="sm"
            onClick={primary.onClick}
            {...gateProps(primary)}
          >
            {primary.label}
          </DisabledReason>
        ) : null}
        {secondary.length ? (
          <>
            <Button
              ref={trigger}
              variant="ghost"
              size="sm"
              aria-label={t("More actions")}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              <MoreHorizontal className="icon-sm" aria-hidden />
            </Button>
            {open ? (
              <DropdownMenu
                anchor={trigger}
                label={t("More actions")}
                items={items}
                returnFocusRef={trigger}
                onPick={pick}
                onClose={() => setOpen(false)}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </header>
  );
}
