import { Button } from "../Button";
import { X } from "../icons";

/**
 * Dismiss control for a popover picker's search header: one icon and ghost size shared by every picker.
 * @group actions
 * @use Trailing slot of PopoverSearchHeader when the picker closes without choosing (Esc or outside stays with the popover).
 * @avoid Closing a Modal or Sheet: its own header close. A footer Cancel: Button.
 */
export function PickerCloseButton({
  label,
  tooltip,
  shortcut,
  onClick,
}: {
  /** Accessible name, such as "Close MCP picker". */
  label: string;
  /** Adds the reason or the way back; never repeat `label`. */
  tooltip?: string;
  /** Keyboard hint shown with the tooltip, such as "Esc". */
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <Button
      iconOnly
      label={label}
      variant="ghost"
      type="button"
      tooltip={tooltip}
      shortcut={shortcut}
      onClick={onClick}
      className="shrink-0"
    >
      <X className="icon-sm" strokeWidth={1.75} />
    </Button>
  );
}
