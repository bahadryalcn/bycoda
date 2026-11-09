import { RadioGroup as ArcRadioGroup, type RadioGroupProps } from "./arc/radio-group/radio-group";
import { RadioTileGroup, type RadioTileGroupProps } from "./RadioTileGroup";
export type { RadioGroupProps, RadioOption } from "./arc/radio-group/radio-group";
export type { RadioTileGroupProps, RadioTileOption } from "./RadioTileGroup";

/**
 * Visible exclusive options. Default `cards`/`list`: native radios with a label and optional description;
 * owns name, default value, required, ref and form reset, the caller owns the value.
 * `variant="tiles"`: buttons with custom content (previews, rows, bars) in a roving-focus radiogroup
 * where arrows, Home and End move the choice; the selected tile is `[aria-checked="true"]` for the caller's CSS.
 * @group choice
 * @use Form choice among 2-6 options that need descriptions, or must submit with a form. Tiles: choose among previews or custom rows.
 * @avoid Filter or display mode over one content area: SegmentedControl. Switching views or panels: Tabs. Long or growing lists: SearchableSelect.
 * @replaces role=radiogroup
 * @arc radio-group
 */
export function RadioGroup(props: RadioGroupProps | RadioTileGroupProps) {
  if (props.variant === "tiles") return <RadioTileGroup {...props} />;
  return <ArcRadioGroup {...props} />;
}
