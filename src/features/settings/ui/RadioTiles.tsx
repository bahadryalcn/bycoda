import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "../../../shared/ui/Button";
import { liveBackgroundKeyTarget } from "./LiveBackgroundPicker";

export type RadioTileOption<T extends string> = {
  value: T;
  /** The tile's content: a preview and a name. */
  children: ReactNode;
  id?: string;
  tooltip?: string;
  /** `data-*` hooks for the tile, such as `{ "data-mode": "dark" }`. */
  data?: Record<`data-${string}`, string>;
};

/**
 * A single choice shown as visual tiles (a mode, a crew, a palette sample). One radiogroup of
 * item Buttons with `role="radio"`: the selected tile is the only tab stop, arrows, Home and End
 * move the choice, and the selected tile carries the accent border from the caller's CSS
 * (`[aria-checked="true"]`). Settings Appearance and onboarding use this one tile pattern.
 */
export function RadioTiles<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  tileClassName,
}: {
  label: string;
  value: T;
  options: readonly RadioTileOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  tileClassName?: string;
}) {
  const group = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = liveBackgroundKeyTarget(event.key, index, options.length);
    const next = target === null ? undefined : options[target];
    if (target === null || !next) return;
    event.preventDefault();
    onChange(next.value);
    group.current
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
      [target]?.focus({ preventScroll: true });
  };
  return (
    <div ref={group} role="radiogroup" aria-label={label} className={className}>
      {options.map((option, index) => {
        const on = value === option.value;
        return (
          <Button
            {...option.data}
            key={option.value}
            id={option.id}
            variant="item"
            motion="none"
            selected={on}
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={tileClassName}
            tooltip={option.tooltip}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.children}
          </Button>
        );
      })}
    </div>
  );
}
