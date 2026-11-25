import { LoadingText } from "../../../shared/ui/LoadingText";
import { useEffect } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Alert } from "../../../shared/ui/Alert";
import { FailureAlert } from "./FailureAlert";
import { useConnectionErrorShownCentrally } from "../../../shared/ui/connectionErrorGate";
import { useProjectCrews } from "../model/crewClient";

/**
 * Choose the crew a task runs with. Shown only once the owner picked Crew as the executor;
 * selecting never starts it. A saved crew that is gone says so instead of being replaced.
 */
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
  onChange: (id: string) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  useLocale();
  const crews = useProjectCrews(cwd, !!cwd && !!machineId);
  const centrally = useConnectionErrorShownCentrally(crews.error);
  const available = crews.data?.machine.id === machineId && crews.data?.taskExecutionSupported;
  const definitions = available ? crews.data!.definitions : [];
  const valid = !value || definitions.some((definition) => definition.id === value);
  // A saved crew cannot be judged missing while the host is still answering or failed to.
  const loading = !!value && !crews.data && !crews.error && crews.isFetching;
  // Reports validity to the form that owns Save; the picker has no other way to block it.
  useEffect(() => onValidityChange(valid), [valid, onValidityChange]);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SearchableSelect
        label={t("Crew")}
        value={value ?? ""}
        disabled={disabled}
        options={definitions.map((definition) => ({
          value: definition.id,
          label: definition.name,
          description: definition.projectId ? t("This project") : t("All projects on this host"),
        }))}
        onChange={onChange}
      />
      {loading && <LoadingText>{t("Loading crews…")}</LoadingText>}
      {crews.error && !centrally && (
        <FailureAlert
          tone="warning"
          title={t("Could not load the crews for this project.")}
          detail={crews.error.message}
          action={{
            label: t("Retry"),
            pending: crews.isFetching,
            onClick: () => void crews.refetch(),
          }}
        />
      )}
      {value && !valid && !loading && !crews.error && (
        <Alert tone="warning">{t("Connect an updated host and choose an available crew.")}</Alert>
      )}
    </div>
  );
}
