import type { ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ChevronDown, Folder, Laptop } from "../../../shared/ui/icons";
import { SearchableSelect, type SearchableSelectOption } from "../../../shared/ui/SearchableSelect";
import { Text } from "../../../shared/ui/Text";
import "./task-form.css";

type TargetChoice = {
  value: string;
  options: readonly SearchableSelectOption[];
  onChange?: (value: string) => void;
  /** Readable value for a locked or unavailable selection. */
  currentLabel?: string;
};

/** Use the caller's Host-scoped choices and mount its existing pickers in the remaining slots. */
export function TaskTargetChips({
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
    <div className="task-target-chips">
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
