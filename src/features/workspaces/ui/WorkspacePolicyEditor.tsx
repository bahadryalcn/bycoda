import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Switch } from "../../../shared/ui/Switch";
import { NumberField } from "../../../shared/ui/NumberField";
import { Select } from "../../../shared/ui/Select";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import {
  AdvancedSettings,
  Group,
  Row,
  SettingsFeedback,
} from "../../settings/public/settingsControls";
import type {
  WorkspacePolicy,
  WorkspacePolicyOverride,
  WorkspaceRpcResponse,
} from "../model/contracts";
import {
  lifecycleLabel,
  workspaceStorageSize,
  type PolicyDiskErrors,
} from "../model/workspacePresentation";
import styles from "./WorkspacePolicySettings.module.css";

const GIB = 1_073_741_824;
const DAY = 86_400_000;
const retentionStates = ["idle", "finished", "merged", "abandoned"] as const;
const fieldValue = (value: number) => (Number.isFinite(value) ? value : "");

export function WorkspacePolicyEditor({
  draft,
  policy,
  saving,
  saved,
  dirty,
  loading,
  policyConflict,
  diskErrors,
  discardDraft,
  save,
  update,
  onKeepEdits,
}: {
  draft: WorkspacePolicy;
  policy: WorkspaceRpcResponse<"projects.workspacePolicy.get">;
  saving: boolean;
  saved: boolean;
  dirty: boolean;
  loading: boolean;
  policyConflict: boolean;
  diskErrors: PolicyDiskErrors;
  discardDraft: () => void;
  save: (override?: WorkspacePolicyOverride) => Promise<void>;
  update: (next: WorkspacePolicy) => void;
  onKeepEdits: () => void;
}) {
  const hasProjectOverride = policy.resolved.appliedScopes.includes("project");
  const invalidDisk = Object.keys(diskErrors).length > 0;
  return (
    <Group
      title={
        <span className="flex flex-wrap items-center gap-2">
          {t("Defaults for new workspaces")}
          <Badge size="sm">
            {hasProjectOverride ? t("Project override") : t("Following Host defaults")}
          </Badge>
        </span>
      }
      layout="full"
      id="workspace-policy"

      info={
        <InfoPopover>
          <p>
            {t(
              "Saving stores every value as a project override. Reset removes the whole override immediately.",
            )}
          </p>
        </InfoPopover>
      }
      persistence={{
        mode: "explicit",
        state: saving ? "saving" : saved ? "saved" : dirty ? "dirty" : "idle",
      }}
      action={
        <div className="flex items-center gap-2">
          {dirty ? (
            <Button variant="ghost" disabled={saving || loading} onClick={discardDraft}>
              {t("Discard changes")}
            </Button>
          ) : null}
          {dirty && (
            <Button
              variant="primary"
              loading={saving}
              loadingLabel={t("Saving…")}
              disabled={!dirty || invalidDisk || loading || policyConflict}
              onClick={async () => await save()}
            >
              {t("Save workspace policy")}
            </Button>
          )}
        </div>
      }
    >
      {policyConflict ? (
        <SettingsFeedback
          state="warning"
          action={
            <>
              <Button variant="ghost" disabled={saving} onClick={discardDraft}>
                {t("Reload Host policy")}
              </Button>
              <Button variant="ghost" disabled={saving} onClick={onKeepEdits}>
                {t("Keep my edits")}
              </Button>
            </>
          }
        >
          {t(
            "The saved policy changed while you were editing. Reload it and lose your edits, or keep them and save over the new revision.",
          )}
        </SettingsFeedback>
      ) : null}
      <Row id="default-workspace-mode" label={t("Default workspace")}>
        <fieldset disabled={saving}>
          <SegmentedControl
            label={t("Default workspace")}
            value={draft.defaultMode}
            options={[
              { value: "worktree", label: t("Worktree") },
              { value: "current", label: t("Current checkout") },
            ]}
            onValueChange={(defaultMode) =>
              update({ ...draft, defaultMode: defaultMode as WorkspacePolicy["defaultMode"] })
            }
          />
        </fieldset>
      </Row>
      <Row
        id="workspace-pinning"
        label={t("Pin new workspaces")}
        description={t("Pinned workspaces are excluded from automatic directory cleanup.")}
        descriptionVisible={false}
      >
        <Switch
          aria-label={t("Pin new workspaces")}
          checked={draft.pinned}
          disabled={saving}
          onCheckedChange={(pinned) => update({ ...draft, pinned })}
        />
      </Row>
      <AdvancedSettings
        id="workspace-retention"
        title={t("Directory retention")}
        defaultOpen={false}
      >
        <p className={styles.retentionHint}>
          {t("Active and pinned workspaces are never cleaned up automatically.")}
        </p>
        <div className={styles.retentionGrid}>
          {retentionStates.map((state) => {
            const period = draft.retention[state];
            const choices = [DAY, 7 * DAY, 14 * DAY, 30 * DAY, "never"] as const;
            return (
              <Row key={state} label={lifecycleLabel(state)}>
                <Select
                  className="w-36"
                  label={t("{p0} retention", { p0: lifecycleLabel(state) })}
                  value={String(period)}
                  disabled={saving}
                  options={[
                    ...choices.map((value) => ({
                      value: String(value),
                      label:
                        value === "never"
                          ? t("Never")
                          : value === DAY
                            ? t("24 hours")
                            : t("{p0} days", { p0: value / DAY }),
                    })),
                    ...(!choices.includes(period as (typeof choices)[number])
                      ? [
                          {
                            value: String(period),
                            label: t("{p0} days", { p0: Number(period) / DAY }),
                          },
                        ]
                      : []),
                  ]}
                  onValueChange={(value) =>
                    update({
                      ...draft,
                      retention: {
                        ...draft.retention,
                        [state]: value === "never" ? "never" : Number(value),
                      },
                    })
                  }
                />
              </Row>
            );
          })}
        </div>
      </AdvancedSettings>
      <AdvancedSettings
        id="workspace-disk-policy"
        title={
          <span>
            {t("Storage limits")} · {workspaceStorageSize(draft.disk.budgetBytes)}
          </span>
        }
        defaultOpen={false}
      >
        <Row label={t("Directory budget (GiB)")}>
          <NumberField
            className="w-36"
            label={t("Directory budget (GiB)")}
            hideLabel
            aria-label={t("Directory budget (GiB)")}
            min={1}
            step={1}
            disabled={saving}
            error={diskErrors.budget}
            value={fieldValue(draft.disk.budgetBytes / GIB)}
            onChange={(event) =>
              update({
                ...draft,
                disk: { ...draft.disk, budgetBytes: event.target.valueAsNumber * GIB },
              })
            }
          />
        </Row>
        <Row label={t("Warn at (%)")}>
          <NumberField
            className="w-36"
            label={t("Warn at (%)")}
            hideLabel
            aria-label={t("Warn at (%)")}
            min={1}
            max={100}
            step={1}
            disabled={saving}
            error={diskErrors.warning}
            value={fieldValue(draft.disk.warningRatio * 100)}
            onChange={(event) =>
              update({
                ...draft,
                disk: { ...draft.disk, warningRatio: event.target.valueAsNumber / 100 },
              })
            }
          />
        </Row>
        <Row label={t("Minimum free space (GiB)")}>
          <NumberField
            className="w-36"
            label={t("Minimum free space (GiB)")}
            hideLabel
            aria-label={t("Minimum free space (GiB)")}
            min={1}
            step={1}
            disabled={saving}
            error={diskErrors.minimumFree}
            value={fieldValue(draft.disk.minimumFreeBytes / GIB)}
            onChange={(event) =>
              update({
                ...draft,
                disk: { ...draft.disk, minimumFreeBytes: event.target.valueAsNumber * GIB },
              })
            }
          />
        </Row>
      </AdvancedSettings>
      {hasProjectOverride && (
        <Row
          label={t("Project override")}
          descriptionVisible={false}
          description={t(
            "Removes this project's whole override, including values you did not edit. This saves immediately.",
          )}
        >
          <Button variant="link" disabled={saving || loading} onClick={async () => await save({})}>
            {t("Reset to Host defaults")}
          </Button>
        </Row>
      )}
    </Group>
  );
}
