import type { CSSProperties } from "react";
import { useT } from "../i18n";
import { RadioGroup } from "./RadioGroup";
import { Switch } from "./Switch";
import { Text } from "./Text";
import styles from "./EffortScale.module.css";

export interface EffortScaleOption {
  value: string;
  label: string;
}

export interface EffortScaleAutomatic {
  /** Automatic is in effect; no bar is the saved choice. */
  on: boolean;
  /** Called with `true` when the switch turns on; the caller clears its saved level. Turning the
   *  switch off, or choosing a bar, sends a level through `onValueChange` instead. */
  onChange: (on: boolean) => void;
  /** Switch text; defaults to "Automatic". */
  label?: string;
}

/**
 * Ascending reasoning bars with the selected level above and speed/depth below. With `automatic`,
 * an Automatic switch leads the header: while it is on the bars read as inactive (any
 * `inheritedValue` fills muted), and choosing a bar turns it off by sending that level.
 * Callers supply catalog order and translated labels.
 * @group choice
 * @use Choosing an ordered model effort or subagent effort ceiling, optionally left to Automatic.
 * @avoid Unordered settings or modes: SegmentedControl. Continuous values: Slider.
 */
export function EffortScale({
  options,
  value,
  label,
  disabled,
  describedBy,
  showValue = true,
  showLabel = true,
  keepFocus,
  inheritedValue,
  automatic,
  onValueChange,
}: {
  /** Levels only, lowest first. */
  options: readonly EffortScaleOption[];
  value: string;
  label: string;
  disabled?: boolean;
  describedBy?: string;
  showValue?: boolean;
  /** Hide the visible label when a surrounding row already names the scale; it stays the accessible name. */
  showLabel?: boolean;
  keepFocus?: boolean;
  /** Level that applies while no level is chosen (Automatic on, or an empty value); its bars fill muted. */
  inheritedValue?: string;
  automatic?: EffortScaleAutomatic;
  onValueChange: (value: string) => void;
}) {
  const t = useT();
  const auto = automatic?.on ?? false;
  const chosen = auto ? -1 : options.findIndex((option) => option.value === value);
  const inheritedIndex = options.findIndex((option) => option.value === inheritedValue);
  const inherited = chosen < 0 ? inheritedIndex : -1;
  const selected = chosen >= 0 ? chosen : inherited;
  const automaticLabel = automatic?.label ?? t("Automatic");
  // The switch already reads "Automatic"; the value names only the level it resolves to.
  const valueText = auto ? options[inherited]?.label : options[chosen]?.label;
  // Leaving Automatic lands on the level that was in effect, else the middle of the scale.
  const manualStart =
    options[inheritedIndex >= 0 ? inheritedIndex : Math.floor((options.length - 1) / 2)]?.value;
  const valueNode = showValue ? (
    <Text size="caption" weight="medium" className={styles.value} wrap="anywhere">
      {valueText}
    </Text>
  ) : null;
  return (
    <div
      className={styles.scale}
      data-disabled={disabled || undefined}
      data-automatic={auto || undefined}
    >
      {automatic ? (
        <>
          {showLabel ? (
            <Text as="div" size="caption" tone="secondary" wrap="anywhere" className={styles.label}>
              {label}
            </Text>
          ) : null}
          <div className={styles.header}>
            <Switch
              label={automaticLabel}
              checked={auto}
              disabled={disabled}
              onCheckedChange={(on) => {
                if (on) automatic.onChange(true);
                else if (manualStart !== undefined) onValueChange(manualStart);
              }}
            />
            {valueNode}
          </div>
        </>
      ) : showValue ? (
        <div className={styles.header}>
          {showLabel ? (
            <Text size="caption" tone="secondary" wrap="anywhere">
              {label}
            </Text>
          ) : null}
          {valueNode}
        </div>
      ) : null}
      <RadioGroup
        variant="tiles"
        label={label}
        aria-describedby={describedBy}
        value={chosen >= 0 ? value : ""}
        disabled={disabled}
        keepFocus={keepFocus}
        className={styles.bars}
        tileClassName={styles.bar}
        tile={{ layout: "stacked" }}
        options={options.map((option, index) => ({
          value: option.value,
          ariaLabel: option.label,
          tooltip: option.label,
          data: {
            "data-filled": index <= selected ? "" : undefined,
            "data-inherited": index <= inherited ? "" : undefined,
            "data-ultra": /^ultra/i.test(option.value) ? "" : undefined,
          },
          content: (
            <span
              className={styles.fill}
              aria-hidden
              style={
                {
                  "--effort-height": `${30 + Math.round((index / Math.max(1, options.length - 1)) * 70)}%`,
                } as CSSProperties
              }
            />
          ),
        }))}
        onValueChange={onValueChange}
      />
      <Text as="div" size="micro" tone="secondary" className={styles.ends} aria-hidden>
        <span>{t("Faster")}</span>
        <span>{t("Deeper")}</span>
      </Text>
    </div>
  );
}
