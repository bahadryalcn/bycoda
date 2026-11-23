import { useId, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { Button } from "./Button";
import { Popover } from "./Popover";
import { Tooltip } from "./Tooltip";
import { Info } from "./icons";

/**
 * Passive info glyph. Pointer hover and keyboard focus reveal the explanation in one tooltip.
 * @group overlay
 * @use Short optional guidance beside a label when there is no control to anchor a Tooltip to.
 * @avoid Required context or warnings: show them in the layout. Structured or actionable details: InfoPopover.
 */
export function InfoTooltip({
  label,
  children,
  className = "",
  icon,
}: {
  /** Accessible name for the glyph. The tooltip displays `children`. */
  label?: string;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  const t = useT();
  const name = label ?? t("Help");
  const classes = `inline-flex ${className}`.trim();
  return (
    <Tooltip asChild label={children}>
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard focus reveals the passive explanation. */}
      <span role="img" aria-label={name} tabIndex={0} className={classes}>
        {icon ?? <Info aria-hidden className="icon-sm" strokeWidth={1.75} />}
      </span>
    </Tooltip>
  );
}

/**
 * Icon-only info button that opens a click-toggled dialog Popover
 * with focus moved in and returned on close. `width` sizes the card; `className` styles the trigger only.
 * @group overlay
 * @use Structured guidance or optional details that need a persistent, scrollable surface.
 * @avoid Short explanation: InfoTooltip or Tooltip. Hover preview of an object: useHoverCard. Required state, errors or approvals: visible in layout (InlineMessage, Alert). Forms or menus: Popover / DropdownMenu.
 */
export function InfoPopover({
  label,
  children,
  width = 320,
  className,
  icon,
}: {
  /** Accessible name. Defaults to "Help". */
  label?: string;
  children: ReactNode;
  width?: number;
  /** Layout hook for the trigger only (e.g. `shrink-0`). */
  className?: string;
  /** Glyph of the trigger; defaults to the info mark. Pass a tone-colored icon for warnings. */
  icon?: ReactNode;
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
        title=""
        className={className}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? contentId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {icon ?? <Info aria-hidden className="icon-sm" strokeWidth={1.75} />}
      </Button>
      {open ? (
        <Popover
          id={contentId}
          anchor={anchor}
          width={width}
          kind="dialog"
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
