import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { radioKeyTarget } from "../lib/radioKeyTarget";
import { Button, type ButtonProps } from "./Button";

type TileButtonProps = Partial<
  Pick<
    Extract<ButtonProps, { iconOnly?: false }>,
    "variant" | "size" | "layout" | "fullWidth" | "motion" | "tooltipWhen"
  >
>;

export interface RadioTileOption {
  value: string;
  /** Tile content, such as a preview and a name. */
  content: ReactNode;
  id?: string;
  /** Accessible name when the content is a picture or a glyph. */
  ariaLabel?: string;
  /** Square icon action; ariaLabel supplies its accessible name. */
  iconOnly?: boolean;
  tooltip?: string;
  disabled?: boolean;
  className?: string;
  /** `data-*` hooks for the tile, such as `{ "data-mode": "dark" }`. */
  data?: Record<`data-${string}`, string | undefined>;
}

export interface RadioTileGroupProps {
  variant: "tiles";
  /** Accessible name of the group. */
  label: string;
  options: readonly RadioTileOption[];
  value: string;
  onValueChange: (value: string) => void;
  /** Preview an option on pointer enter or focus without changing the selected value. */
  onOptionIntent?: (value: string) => void;
  disabled?: boolean;
  "aria-describedby"?: string;
  /** Layout of the group (grid, columns, scroll area). */
  className?: string;
  /** Applied to every tile; the selected tile is `[aria-checked="true"]`. */
  tileClassName?: string;
  /** Button presentation shared by the tiles. Default `variant="item"`. */
  tile?: TileButtonProps;
  /** Keep focus where it is on pointer press, for pickers whose search field keeps the caret. */
  keepFocus?: boolean;
}

/**
 * Exclusive choice shown as buttons with custom content (previews, rows, bars) in one `radiogroup`.
 * Owns roving focus: the selected (or first enabled) tile is the only tab stop; arrows, Home and End
 * move focus and choice together. Reached through `RadioGroup variant="tiles"`.
 * @status internal
 */
export function RadioTileGroup({
  label,
  options,
  value,
  onValueChange,
  onOptionIntent,
  disabled,
  className,
  tileClassName,
  tile,
  keepFocus,
  "aria-describedby": describedBy,
}: RadioTileGroupProps) {
  const group = useRef<HTMLDivElement>(null);
  const isEnabled = (index: number) => !disabled && !options[index]?.disabled;
  const selected = options.findIndex((option) => option.value === value);
  const tabStop =
    selected >= 0 && isEnabled(selected) ? selected : options.findIndex((_, i) => isEnabled(i));
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = radioKeyTarget(event.key, index, options.length, isEnabled);
    const next = target === null ? undefined : options[target];
    if (target === null || !next) return;
    event.preventDefault();
    onValueChange(next.value);
    group.current
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
      [target]?.focus({ preventScroll: true });
  };
  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label}
      aria-describedby={describedBy}
      className={className}
    >
      {options.map((option, index) => {
        const on = index === selected;
        return (
          <Button
            {...option.data}
            key={option.value}
            id={option.id}
            variant="item"
            {...tile}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={option.ariaLabel}
            {...(option.iconOnly
              ? { iconOnly: true, label: option.ariaLabel ?? option.tooltip ?? option.value }
              : { iconOnly: false })}
            selected={on}
            tabIndex={index === tabStop ? 0 : -1}
            disabled={!isEnabled(index)}
            tooltip={option.tooltip}
            className={[tileClassName, option.className].filter(Boolean).join(" ") || undefined}
            onMouseDown={keepFocus ? (event) => event.preventDefault() : undefined}
            onClick={() => onValueChange(option.value)}
            onPointerEnter={onOptionIntent ? () => onOptionIntent(option.value) : undefined}
            onFocus={onOptionIntent ? () => onOptionIntent(option.value) : undefined}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.content}
          </Button>
        );
      })}
    </div>
  );
}
