import type { ReactNode } from "react";
import { useT } from "../i18n";
import { Button } from "./Button";
import { ChevronDown, Folder, Laptop } from "./icons";
import { SearchableSelect, type SearchableSelectOption } from "./SearchableSelect";
import { Text } from "./Text";
import styles from "./TargetChips.module.css";

export type TargetChoice = {
  value: string;
  options: readonly SearchableSelectOption[];
  /** Omit to show the current value as plain text (a locked or saved target). */
  onChange?: (value: string) => void;
  /** Readable value for a locked or unavailable selection. */
  currentLabel?: string;
};

/**
 * One wrapping row of quiet chips that say where and how an item runs: Machine, Project and the
 * caller's own Model, Access and Working copy pickers. The Machine chip is hidden when there is
 * nothing else to choose; a choice without `onChange` reads as plain text. The caller passes
 * choices already scoped to the chosen machine; the row owns no data.
 * @group choice
 * @use The target row of a task, goal, steward or automation form.
 * @avoid A labelled field in a settings list: SearchableSelect with a Row. A single value picker outside a form: SearchableSelect.
 * @example
 * <TargetChips
 *   machine={{ value: machineId, options: machines, onChange: setMachine }}
 *   project={{ value: cwd, options: projects, onChange: setCwd }}
 *   model={<ModelPicker presentation="chip" ... />}
 *   access={<AccessPicker ... />}
 * />
 */
export function TargetChips({
  machine,
  project,
  model,
  access,
  workingCopy,
  disabled,
}: {
  machine?: TargetChoice;
  project?: TargetChoice;
  model?: ReactNode;
  access?: ReactNode;
  workingCopy?: ReactNode;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <div className={styles.chips}>
      {machine && machine.options.some((option) => option.value !== machine.value) ? (
        <TargetChip
          {...machine}
          disabled={disabled}
          label={t("Machine")}
          icon={<Laptop className="icon-xs" aria-hidden />}
        />
      ) : null}
      {project ? (
        <TargetChip
          {...project}
          disabled={disabled}
          label={t("Project")}
          placeholder={t("Choose project")}
          icon={<Folder className="icon-xs" aria-hidden />}
        />
      ) : null}
      {model}
      {access}
      {workingCopy}
    </div>
  );
}

function TargetChip({
  value,
  options,
  onChange,
  currentLabel,
  label,
  placeholder,
  icon,
  disabled,
}: TargetChoice & { label: string; placeholder?: string; icon: ReactNode; disabled?: boolean }) {
  const selected = options.find((option) => option.value === value)?.label ?? currentLabel;
  if (!onChange) {
    return (
      <Text as="div" size="caption" tone="secondary" className="flex min-w-0 items-center gap-1.5">
        {icon}
        <span className="sr-only">{label}, </span>
        <Text truncate size="inherit" tone="inherit">
          {selected ?? placeholder ?? label}
        </Text>
      </Text>
    );
  }
  return (
    <SearchableSelect
      hideLabel
      label={label}
      placeholder={placeholder}
      disabled={disabled}
      value={value}
      options={options}
      onChange={onChange}
      renderTrigger={({ props }) => (
        <Button
          {...props}
          variant="chip"
          startIcon={icon}
          endIcon={<ChevronDown className="icon-xs" aria-hidden />}
          className="min-w-0 max-w-full"
        >
          <Text truncate size="inherit" tone="inherit">
            {selected ?? placeholder ?? label}
          </Text>
        </Button>
      )}
    />
  );
}
