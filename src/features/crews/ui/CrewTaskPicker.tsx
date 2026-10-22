import { useEffect } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Alert } from "../../../shared/ui/Alert";
import { useProjectCrews } from "../model/crewClient";

/** Shared by task creation and editing; selecting a crew never starts it. */
export function CrewTaskPicker({
  cwd,
  machineId,
  value,
  disabled,
  onChange,
  onValidityChange,
}: {
  cwd: string;
  machineId?: string;
  value?: string;
  disabled?: boolean;
  onChange: (id: string | undefined) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  useLocale();
  const crews = useProjectCrews(cwd, !!cwd && !!machineId);
  const available = crews.data?.machine.id === machineId && crews.data?.taskExecutionSupported;
  const definitions = available ? crews.data!.definitions : [];
  const valid = !value || definitions.some((definition) => definition.id === value);
  useEffect(() => onValidityChange(valid), [valid, onValidityChange]);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SearchableSelect
        label={t("Run with")}
        value={value ?? ""}
        disabled={disabled}
        options={[
          { value: "", label: t("Single agent") },
          ...definitions.map((definition) => ({
            value: definition.id,
            label: definition.name,
            description: definition.projectId ? t("This project") : t("All projects on this host"),
          })),
        ]}
        onChange={(id) => onChange(id || undefined)}
      />
      {value && !valid && (
        <Alert tone="warning">{t("Connect an updated host and choose an available crew.")}</Alert>
      )}
      {value && valid && (
        <p className="text-xs text-(--ui-text-secondary)">
          {t("This task starts its own crew run. The team can also work on other tasks.")}
        </p>
      )}
    </div>
  );
}
