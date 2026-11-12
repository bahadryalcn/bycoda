import { Text } from "../../../shared/ui/Text";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { useEffect } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { RefreshCw } from "../../../shared/ui/icons";
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
  // A saved crew cannot be judged missing while the host is still answering or failed to.
  const loading = !!value && !crews.data && !crews.error && crews.isFetching;
  useEffect(() => onValidityChange(valid), [valid, onValidityChange]);
  // A host without Crews support offers nothing to choose. With no crew saved on the task, the
  // choice collapses to one quiet line; its reason and retry stay behind the information control.
  // A saved crew keeps the full picker and alerts so the task cannot silently lose its crew.
  const unsupported = !value && (crews.error != null || (crews.data != null && !available));
  if (unsupported)
    return (
      <Text data-crew-task-unsupported="" as="div" className="flex min-w-0 items-center gap-1">
        <Text size="inherit" tone="inherit" truncate className="min-w-0">
          {t("Runs as a single agent")}
        </Text>
        <InfoPopover label={t("Crews unavailable")} className="shrink-0">
          <p>
            {crews.error
              ? crews.error.message
              : t("This host cannot run tasks with a crew. Connect an updated host to use crews.")}
          </p>
          {crews.error ? (
            <Button
              variant="ghost"
              startIcon={<RefreshCw className="icon-sm" />}
              loading={crews.isFetching}
              onClick={() => void crews.refetch()}
            >
              {t("Retry")}
            </Button>
          ) : null}
        </InfoPopover>
      </Text>
    );
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SearchableSelect
        hideLabel
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
      {loading && <LoadingText>{t("Loading crews…")}</LoadingText>}
      {crews.error && (
        <Alert
          tone="warning"
          action={
            <Button
              variant="ghost"
              startIcon={<RefreshCw className="icon-sm" />}
              loading={crews.isFetching}
              onClick={() => void crews.refetch()}
            >
              {t("Retry")}
            </Button>
          }
        >
          {crews.error.message}
        </Alert>
      )}
      {value && !valid && !loading && !crews.error && (
        <Alert tone="warning">{t("Connect an updated host and choose an available crew.")}</Alert>
      )}
      {value && valid && (
        <Text as="p">
          {t("This task starts its own crew run. The team can also work on other tasks.")}
        </Text>
      )}
    </div>
  );
}
