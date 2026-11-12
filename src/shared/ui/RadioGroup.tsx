import { RadioGroup as ArcRadioGroup, type RadioGroupProps } from "./arc/radio-group/radio-group";
import { RadioTileGroup, type RadioTileGroupProps } from "./RadioTileGroup";
export type { RadioGroupProps, RadioOption } from "./arc/radio-group/radio-group";
export type { RadioTileGroupProps, RadioTileOption } from "./RadioTileGroup";

/**
 * Visible exclusive options. Default `cards`/`list`: native radios with a label and optional description;
 * owns name, default value, required, ref and form reset, the caller owns the value.
 * `variant="inline"` keeps short in-form choices in a compact row without a visible legend;
 * use the default rows for descriptions. Its native radios keep form submission and validation.
 * `variant="tiles"`: buttons with custom content (previews, rows, bars) in a roving-focus radiogroup
 * where arrows, Home and End move the choice; the selected tile is `[aria-checked="true"]` for the caller's CSS.
 * @group choice
 * @use In-form exclusive choice needing descriptions, native name/required/reset semantics, or a visual preview. Tiles are the internal renderer for preview and custom-content choices, not another public family.
 * @avoid A short immediate setting or filter/presentation mode over the same content: SegmentedControl. Navigation to tools, sections or editors: Tabs. Long or growing lists: SearchableSelect.
 * @replaces role=radiogroup
 * @arc radio-group
 */
export function RadioGroup(props: RadioGroupProps | RadioTileGroupProps) {
  if (props.variant === "tiles") return <RadioTileGroup {...props} />;
  return <ArcRadioGroup {...props} />;
}
