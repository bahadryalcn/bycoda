import { SegmentedControl } from "../SegmentedControl";
import { Select as SharedSelect, type SelectProps } from "../Select";
import { Slider as SharedSlider } from "../Slider";
import { Switch } from "../Switch";
import { Text } from "../Text";

import "./settings.css";

let toggleCue: (() => void) | null = null;

/** Registers the cue played when a settings Toggle flips; the app root supplies it so shared UI stays feature-free. */
export function setToggleCue(cue: (() => void) | null) {
  toggleCue = cue;
}

/** Radio-style segmented choice for a settings Row. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  optionIdPrefix,
  disabled = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  optionIdPrefix?: string;
  /** Blocks every option, e.g. while this row's save is pending. */
  disabled?: boolean;
}) {
  return (
    <SegmentedControl
      label={label}
      value={value}
      options={disabled ? options.map((option) => ({ ...option, disabled: true })) : options}
      onValueChange={(next) => {
        const selected = options.find((option) => option.value === next);
        if (selected) onChange(selected.value);
      }}
      selectionRole="radio"
      optionIdPrefix={optionIdPrefix}
    />
  );
}

/** Settings Row slider with a fixed-width value readout. */
export function Slider({
  label,
  value,
  display,
  min,
  max,
  step = 1,
  onChange,
  disabled = false,
  onValueCommit,
  className,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  onValueCommit?: (value: number) => void;
  /** Extra class on the track element, for a caller-owned track role (for example a hue ramp). */
  className?: string;
}) {
  return (
    <div className="flex w-56 max-w-full items-center gap-3">
      <SharedSlider
        label={label}
        hideLabel
        showValue={false}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        className={["min-w-0 flex-1", className].filter(Boolean).join(" ")}
        format={() => display}
        onValueChange={onChange}
        onValueCommit={onValueCommit}
      />
      <Text
        size="caption"
        tone={disabled ? "disabled" : "primary"}
        className="min-w-[6ch] shrink-0 text-right tabular-nums"
      >
        {display}
      </Text>
    </div>
  );
}

/** Compact on/off switch for a settings Row; plays the registered cue. */
export function Toggle({
  label,
  on,
  onChange,
  disabled = false,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Switch
      type="button"
      aria-label={label}
      checked={on}
      compact
      disabled={disabled}
      onCheckedChange={(next) => {
        onChange(next);
        toggleCue?.();
      }}
      className="settings-toggle shrink-0"
    />
  );
}

/** Settings compatibility facade; shared UI owns the choice interaction. */
export function Select({
  onChange,
  ...props
}: Omit<SelectProps, "onValueChange"> & {
  onChange: (value: string) => void;
}) {
  return <SharedSelect {...props} onValueChange={onChange} />;
}
