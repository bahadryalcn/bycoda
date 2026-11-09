import { useId, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { Button } from "./Button";
import { Popover } from "./Popover";
import { Info } from "./icons";

/**
 * Icon-only info button (name and tooltip default to "Help") that opens a click-toggled dialog Popover
 * with focus moved in and returned on close. `width` sizes the card; `className` styles the trigger only.
 * @group overlay
 * @use Optional explanation next to a label or setting that needs more than one line.
 * @avoid One-line hint on a control: Tooltip. Hover preview of an object: HoverCard. Required state, errors or approvals: visible in layout (InlineMessage, Alert). Forms or menus: Popover / DropdownMenu.
 */
export function InfoPopover({
  label,
  children,
  width = 320,
  className,
}: {
  /** Accessible name and tooltip. Defaults to "Help". */
  label?: string;
  children: ReactNode;
  width?: number;
  /** Layout hook for the trigger only (e.g. `shrink-0`). */
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const contentId = useId();
  const name = label ?? t("Help");
  return (
    <>
      <Button
        ref={anchor}
        type="button"
        variant="ghost"
        size="sm"
        iconOnly
        label={name}
        tooltip={name}
        className={className}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? contentId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <Info aria-hidden className="icon-sm" strokeWidth={1.75} />
      </Button>
      {open ? (
        <Popover
          id={contentId}
          anchor={anchor}
          width={width}
          role="dialog"
          aria-label={name}
          tabIndex={-1}
          autoFocus
          flow="scroll"
          onDismiss={() => setOpen(false)}
          className="flex flex-col gap-2 p-3 text-ui-secondary text-(--ui-text-secondary)"
        >
          {children}
        </Popover>
      ) : null}
    </>
  );
}
