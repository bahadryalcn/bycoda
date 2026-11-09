import type { ReactNode } from "react";
import { RadioGroup } from "../../../shared/ui/RadioGroup";

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
 * A single choice shown as visual tiles (a mode, a crew, a palette sample): `RadioGroup variant="tiles"`
 * with item tiles. The selected tile carries the accent border from the caller's CSS
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
  return (
    <RadioGroup
      variant="tiles"
      label={label}
      value={value}
      className={className}
      tileClassName={tileClassName}
      tile={{ motion: "none" }}
      options={options.map(({ children, ...option }) => ({ ...option, content: children }))}
      onValueChange={(next) => onChange(next as T)}
    />
  );
}
