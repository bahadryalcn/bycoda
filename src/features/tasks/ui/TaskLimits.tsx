import { useRef, useState } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { t } from "../../../shared/i18n";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Spinner } from "../../../shared/ui/Spinner";
import type { RemoteMachine } from "../../connections";
import { presentRemoteError } from "../../connections/public/remoteFailure";
import type { HostSettings } from "../model/hostSettings";
import { type MachineLimits, saveMachineLimits } from "../model/settingsClient";
import { TaskConcurrencyField } from "./TaskConcurrencyField";
import { TaskFormRow } from "./TaskFormFields";

/** Saves limits on the machine named; true once its host acknowledged them. */
export type SaveLimits = (
  machineId: string,
  settings: Partial<HostSettings>,
) => void | boolean | Promise<void | boolean>;

export function MachineConcurrency({
  machineId,
  limits,
  onChange,
}: {
  machineId: string;
  limits: readonly MachineLimits[];
  onChange: SaveLimits;
}) {
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const limit = limits.find((entry) => entry.machineId === machineId);
  if (!limit) return null;
  const label = t("Machine task limit");
  return (
    <TaskFormRow
      label={
        <span className="inline-flex items-center gap-1">
          {label}
          {saving ? <Spinner size="xs" /> : null}
          <InfoPopover>
            {t("Saved immediately for {p0}; it is not part of this task.", {
              p0: limit.machineName,
            })}
          </InfoPopover>
        </span>
      }
    >
      <TaskConcurrencyField
        key={machineId}
        label={label}
        hideLabel
        value={limit.maxRunningTasks}
        disabled={saving || limit.stale}
        onSave={async (value) => {
          if (pending.current) return false;
          pending.current = true;
          setSaving(true);
          try {
            return await onChange(machineId, { maxRunningTasks: value });
          } finally {
            pending.current = false;
            setSaving(false);
          }
        }}
      />
    </TaskFormRow>
  );
}

/** Commits to the addressed Host and publishes the acknowledged limits to the board query. */
export function useMachineLimitSave(
  machines: readonly RemoteMachine[],
  putLimits: (saved: MachineLimits) => void,
  onResult: (error: string | null) => void,
): SaveLimits {
  return useStableCallback(async (machineId: string, settings: Partial<HostSettings>) => {
    const machine = machines.find((entry) => entry.id === machineId);
    if (!machine) return false;
    try {
      putLimits(await saveMachineLimits(machine, settings));
      onResult(null);
      return true;
    } catch (reason: unknown) {
      onResult(presentRemoteError(reason, { explicit: true }));
      return false;
    }
  });
}
