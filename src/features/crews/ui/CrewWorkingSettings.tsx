import { t, useLocale } from "../../../shared/i18n";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { NumberField } from "../../../shared/ui/NumberField";
import { Switch } from "../../../shared/ui/Switch";
import type { CrewPolicy } from "../model/crew";

export type CrewPolicyErrors = {
  maxParallel: string;
  maxAssignments: string;
  maxRunMinutes: string;
};

/**
 * The crew's rare settings, shown under the editor's More options: the three execution limits
 * and the two grants for provider sub-agents and coordinator approvals. The draft stays with
 * the editor; this component only edits it.
 */
export function CrewWorkingSettings({
  policy,
  errors,
  onPolicyChange,
}: {
  policy: CrewPolicy;
  errors: CrewPolicyErrors;
  onPolicyChange: (patch: Partial<CrewPolicy>) => void;
}) {
  useLocale();
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
        <NumberField
          label={t("Members working at once")}
          fieldVariant="compact"
          min={1}
          max={4}
          value={policy.maxParallel}
          error={errors.maxParallel || undefined}
          onChange={(event) => onPolicyChange({ maxParallel: Number(event.target.value) })}
        />
        <NumberField
          label={t("Assignments per work")}
          fieldVariant="compact"
          min={1}
          max={20}
          value={policy.maxAssignments}
          error={errors.maxAssignments || undefined}
          onChange={(event) => onPolicyChange({ maxAssignments: Number(event.target.value) })}
        />
        <NumberField
          label={t("Minutes per assignment")}
          fieldVariant="compact"
          min={1}
          max={240}
          value={policy.maxRunMinutes}
          error={errors.maxRunMinutes || undefined}
          onChange={(event) => onPolicyChange({ maxRunMinutes: Number(event.target.value) })}
        />
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <Switch
          label={t("Coordinator answers permission requests")}
          checked={policy.delegateApprovals === true}
          onCheckedChange={(value) => onPolicyChange({ delegateApprovals: value })}
        />
        <InfoPopover label={t("About coordinator approvals")}>
          <p>
            {t(
              "Only the current coordinator can answer, and only for the request that is open now.",
            )}
          </p>
        </InfoPopover>
      </div>
      <Switch
        label={t("Allow provider sub-agents")}
        checked={policy.allowSubagents}
        onCheckedChange={(value) => onPolicyChange({ allowSubagents: value })}
      />
    </div>
  );
}
