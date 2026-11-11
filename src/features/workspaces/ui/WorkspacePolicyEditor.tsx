import { useId } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Switch } from "../../../shared/ui/Switch";
import { NumberField } from "../../../shared/ui/NumberField";
import { Select } from "../../../shared/ui/Select";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { Heading } from "../../../shared/ui/Heading";
import { Group, Row, SettingsFeedback } from "../../settings/public/settingsControls";
import type {
  WorkspacePolicy,
  WorkspacePolicyOverride,
  WorkspaceRpcResponse,
} from "../model/contracts";
import { lifecycleLabel, type PolicyDiskErrors } from "../model/workspacePresentation";
import styles from "./WorkspacePolicySettings.module.css";

const GIB = 1_073_741_824;
const DAY = 86_400_000;
const retentionStates = ["idle", "finished", "merged", "abandoned"] as const;
const retentionChoices = [DAY, 7 * DAY, 14 * DAY, 30 * DAY, "never"] as const;
const fieldValue = (value: number) => (Number.isFinite(value) ? value : "");

export function WorkspacePolicyEditor({
  draft,
  policy,
  saving,
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
  const retentionHeadingId = useId();
  const limitsHeadingId = useId();
  const hasProjectOverride = policy.resolved.appliedScopes.includes("project");
  const invalidDisk = Object.keys(diskErrors).length > 0;
  return (
    <Group
      title={
        <span className={styles.groupTitle}>
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
      action={
        hasProjectOverride ? (
          <Button variant="link" disabled={saving || loading} onClick={async () => await save({})}>
            {t("Reset to Host defaults")}
          </Button>
        ) : undefined
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
      <Row
        id="default-workspace-mode"
        label={t("Default workspace")}
        description={t("Worktree gives each session its own folder and branch.")}
      >
        <FieldGroup legend={t("Default workspace")} hideLegend disabled={saving}>
          <SegmentedControl
            label={t("Default workspace")}
            value={draft.defaultMode}
            options={[
              { value: "worktree", label: t("Worktree") },
              { value: "current", label: t("Current checkout") },
            ]}
            onValueChange={(defaultMode) =>
              update({
                ...draft,
                defaultMode: defaultMode as WorkspacePolicy["defaultMode"],
              })
            }
          />
        </FieldGroup>
      </Row>
      <Row
        id="workspace-pinning"
        label={t("Pin workspaces")}
        description={t(
          "Pinned workspaces are never cleaned up automatically. Applies to existing workspaces too.",
        )}
      >
        <Switch
          aria-label={t("Pin workspaces")}
          checked={draft.pinned}
          disabled={saving}
          onCheckedChange={(pinned) => update({ ...draft, pinned })}
        />
      </Row>
      <section
        id="setting-workspace-retention"
        data-setting-id="workspace-retention"
        aria-labelledby={retentionHeadingId}
        className={styles.block}
      >
        <Heading size="item" id={retentionHeadingId} className={styles.subheading}>
          {t("Automatic cleanup")}
          <small className={styles.muted}>{t("Active and pinned workspaces are excluded")}</small>
        </Heading>
        <div className={styles.grid4}>
          {retentionStates.map((state) => {
            const period = draft.retention[state];
            const label = lifecycleLabel(state);
            return (
              <div key={state} className={styles.cell}>
                <span className={styles.cellLabel}>{label}</span>
                <Select
                  hideLabel
                  className="w-full"
                  label={t("{p0} retention", { p0: label })}
                  value={String(period)}
                  disabled={saving}
                  options={[
                    ...retentionChoices.map((value) => ({
                      value: String(value),
                      label:
                        value === "never"
                          ? t("Never")
                          : value === DAY
                            ? t("24 hours")
                            : t("{p0} days", { p0: value / DAY }),
                    })),
                    ...(!retentionChoices.includes(period as (typeof retentionChoices)[number])
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
              </div>
            );
          })}
        </div>
      </section>
      <section
        id="setting-workspace-disk-policy"
        data-setting-id="workspace-disk-policy"
        aria-labelledby={limitsHeadingId}
        className={styles.block}
      >
        <Heading size="item" id={limitsHeadingId} className={styles.subheading}>
          {t("Limits")}
        </Heading>
        <div className={styles.grid3}>
          <div className={styles.cell}>
            <span className={styles.cellLabel}>{t("Directory budget (GiB)")}</span>
            <NumberField
              className="w-full"
              label={t("Directory budget (GiB)")}
              hideLabel
              min={1}
              step={1}
              disabled={saving}
              error={diskErrors.budget}
              value={fieldValue(draft.disk.budgetBytes / GIB)}
              onChange={(event) =>
                update({
                  ...draft,
                  disk: {
                    ...draft.disk,
                    budgetBytes: event.target.valueAsNumber * GIB,
                  },
                })
              }
            />
          </div>
          <div className={styles.cell}>
            <span className={styles.cellLabel}>{t("Warn at (%)")}</span>
            <NumberField
              className="w-full"
              label={t("Warn at (%)")}
              hideLabel
              min={1}
              max={100}
              step={1}
              disabled={saving}
              error={diskErrors.warning}
              value={fieldValue(draft.disk.warningRatio * 100)}
              onChange={(event) =>
                update({
                  ...draft,
                  disk: {
                    ...draft.disk,
                    warningRatio: event.target.valueAsNumber / 100,
                  },
                })
              }
            />
          </div>
          <div className={styles.cell}>
            <span className={styles.cellLabel}>{t("Minimum free space (GiB)")}</span>
            <NumberField
              className="w-full"
              label={t("Minimum free space (GiB)")}
              hideLabel
              min={1}
              step={1}
              disabled={saving}
              error={diskErrors.minimumFree}
              value={fieldValue(draft.disk.minimumFreeBytes / GIB)}
              onChange={(event) =>
                update({
                  ...draft,
                  disk: {
                    ...draft.disk,
                    minimumFreeBytes: event.target.valueAsNumber * GIB,
                  },
                })
              }
            />
          </div>
        </div>
      </section>
      {dirty && (
        <div className={styles.saveBar}>
          <span className={styles.saveDot} aria-hidden="true" />
          <span>{t("Unsaved changes")}</span>
          <span className={styles.saveSpacer} />
          <Button variant="ghost" disabled={saving || loading} onClick={discardDraft}>
            {t("Discard changes")}
          </Button>
          <Button
            variant="primary"
            loading={saving}
            loadingLabel={t("Saving…")}
            disabled={invalidDisk || loading || policyConflict}
            onClick={async () => await save()}
          >
            {t("Save")}
          </Button>
        </div>
      )}
    </Group>
  );
}
