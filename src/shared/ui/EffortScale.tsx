import type { CSSProperties, ReactNode } from "react";
import { useT } from "../i18n";
import { RadioGroup } from "./RadioGroup";
import { Text } from "./Text";
import styles from "./EffortScale.module.css";

export interface EffortScaleOption {
  value: string;
  label: string;
  /** Non-level choices such as Automatic use an icon instead of a bar. */
  icon?: ReactNode;
}

/**
 * Ascending reasoning bars with the selected level above and speed/depth below.
 * Callers supply catalog order, translated labels and any inheritance choice.
 * @group choice
 * @use Choosing an ordered model effort or subagent effort ceiling.
 * @avoid Unordered settings or modes: SegmentedControl. Continuous values: Slider.
 */
export function EffortScale({
  options,
  value,
  label,
  disabled,
  describedBy,
  showValue = true,
  keepFocus,
  onValueChange,
}: {
  options: readonly EffortScaleOption[];
  value: string;
  label: string;
  disabled?: boolean;
  describedBy?: string;
  showValue?: boolean;
  keepFocus?: boolean;
  onValueChange: (value: string) => void;
}) {
  const t = useT();
  const levels = options.filter((option) => !option.icon);
  const selected = levels.findIndex((option) => option.value === value);
  return (
    <div className={styles.scale} data-disabled={disabled || undefined}>
      {showValue ? (
        <div className={styles.header}>
          <Text size="caption" tone="secondary" wrap="anywhere">
            {label}
          </Text>
          <Text size="caption" weight="medium" className={styles.value} wrap="anywhere">
            {options.find((option) => option.value === value)?.label}
          </Text>
        </div>
      ) : null}
      <RadioGroup
        variant="tiles"
        label={label}
        aria-describedby={describedBy}
        value={value}
        disabled={disabled}
        keepFocus={keepFocus}
        className={styles.bars}
        tileClassName={styles.bar}
        tile={{ layout: "stacked" }}
        options={options.map((option) => {
          const index = levels.indexOf(option);
          return {
            value: option.value,
            ariaLabel: option.label,
            tooltip: option.label,
            data: {
              "data-filled": index >= 0 && index <= selected ? "" : undefined,
              "data-ultra": /^ultra/i.test(option.value) ? "" : undefined,
            },
            content: option.icon ?? (
              <span
                className={styles.fill}
                aria-hidden
                style={
                  {
                    "--effort-height": `${30 + Math.round((index / Math.max(1, levels.length - 1)) * 70)}%`,
                  } as CSSProperties
                }
              />
            ),
          };
        })}
        onValueChange={onValueChange}
      />
      <Text as="div" size="micro" tone="secondary" className={styles.ends} aria-hidden>
        <span>{t("Faster")}</span>
        <span>{t("Deeper")}</span>
      </Text>
    </div>
  );
}
