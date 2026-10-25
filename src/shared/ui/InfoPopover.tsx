import { useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { Button } from "./Button";
import { Popover } from "./Popover";
import { Info } from "./icons";

/**
 * Optional help behind an icon-only information control. The hint never owns
 * required state, errors or approvals; those stay visible in the layout.
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
        onClick={() => setOpen((current) => !current)}
      >
        <Info aria-hidden className="icon-sm" strokeWidth={1.75} />
      </Button>
      {open ? (
        <Popover
          anchor={anchor}
          width={width}
          role="dialog"
          aria-label={name}
          onDismiss={() => setOpen(false)}
          className="flex flex-col gap-2 p-3 text-ui-caption text-(--ui-text-secondary)"
        >
          {children}
        </Popover>
      ) : null}
    </>
  );
}
