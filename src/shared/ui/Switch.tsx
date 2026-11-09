import { Switch as ArcSwitch, type SwitchProps as ArcSwitchProps } from "./arc/switch/switch";
import type { Ref } from "react";

export type SwitchProps = ArcSwitchProps & { ref?: Ref<HTMLButtonElement> };

/**
 * Compact on/off toggle that applies immediately on change. Domain callbacks and sound belong to the consumer.
 * A switch with visible text uses `label` (`labelPosition="start"` puts the text before the track, `description` adds a secondary line); the text is part of the button. Never wrap a Switch in a raw `<label>`.
 * @group choice
 * @use A setting that takes effect the moment it flips (preferences, enable/disable a feature).
 * @avoid Choice committed with a form Save, or a selection among items: Checkbox. One of several modes: SegmentedControl or RadioGroup.
 * @arc switch
 */
export function Switch({ className, compact = true, type = "button", ...props }: SwitchProps) {
  return (
    <ArcSwitch
      {...props}
      type={type}
      compact={compact}
      className={["bycoda-arc bycoda-arc-switch", className].filter(Boolean).join(" ")}
    />
  );
}
