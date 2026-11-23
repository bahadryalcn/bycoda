import type { ReactNode } from "react";
import { Check } from "../icons";
import { OverflowTooltip } from "../Tooltip";
import choice from "../arc/combobox/combobox.module.css";
import styles from "./picker.module.css";

/**
 * Content slots shared by Select, SearchableSelect and composable PickerList rows.
 * The row controller owns focus and selection; Arc owns every row state.
 * @group choice
 * @use Inside a shared choice row, with its committed selected state.
 * @avoid Complete fields: Select or SearchableSelect. Commands: MenuRow.
 */
export function PickerChoice({
  selected,
  icon,
  label,
  description,
  descriptionId,
  title,
  meta,
  trailing,
  showSelection = true,
}: {
  selected: boolean;
  icon?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  descriptionId?: string;
  title?: string;
  meta?: ReactNode;
  trailing?: ReactNode;
  /** False only for action lists without a committed selection. */
  showSelection?: boolean;
}) {
  const check = selected ? <Check aria-hidden /> : null;
  const checkSlot = (
    <span className={choice.choiceCheck} aria-hidden="true">
      {check}
    </span>
  );
  return (
    <>
      {showSelection ? checkSlot : null}
      {icon != null ? (
        <span className={choice.choiceIcon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <OverflowTooltip label={title}>
        <span className={choice.choiceBody}>
          <span className={`${choice.choiceLabel} truncate`}>{label}</span>
          {description != null ? (
            <span
              id={descriptionId}
              className={`${choice.choiceDescription} ${styles.description} bycoda-select-description`}
            >
              {description}
            </span>
          ) : null}
        </span>
      </OverflowTooltip>
      {meta != null ? (
        <OverflowTooltip label={typeof meta === "string" ? meta : undefined}>
          <span className={styles.meta}>{meta}</span>
        </OverflowTooltip>
      ) : null}
      {trailing != null ? <span className={styles.trailing}>{trailing}</span> : null}
    </>
  );
}
