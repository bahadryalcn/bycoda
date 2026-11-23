import { Text } from "../../../shared/ui/Text";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Switch } from "../../../shared/ui/Switch";
import { NumberField } from "../../../shared/ui/NumberField";
import { Select } from "../../../shared/ui/Select";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { Group, Row, SettingsFeedback, SettingsSaveBar } from "../../../shared/ui/settings";
import { workspacePolicyChanges } from "./workspacePolicyChanges";
import type {
  WorkspacePolicy,
  WorkspacePolicyOverride,
  WorkspaceRpcResponse,
} from "../model/contracts";
import { lifecycleLabel, type PolicyDiskErrors } from "../model/workspacePresentation";

const GIB = 1_073_741_824;
const DAY = 86_400_000;
const retentionStates = ["idle", "finished", "merged", "abandoned"] as const;
const retentionChoices = [DAY, 7 * DAY, 14 * DAY, 30 * DAY, "never"] as const;
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
  save: (override?: WorkspacePolicyOverride) => Promise<boolean>;
  update: (next: WorkspacePolicy) => void;
  onKeepEdits: () => void;
}) {
  const hasProjectOverride = policy.resolved.appliedScopes.includes("project");
  const invalidDisk = Object.keys(diskErrors).length > 0;
  const listed = dirty ? workspacePolicyChanges(draft, policy.resolved.policy, update) : [];
  // Anything the list does not name still counts, so Save never hides behind a clean count.
  const changes = dirty && !listed.length ? [{ id: "other", label: t("Other changes") }] : listed;
  return (
    <Group
      title={t("Defaults for new workspaces")}
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
          action={{ label: t("Reload Host policy"), disabled: saving, onClick: discardDraft }}
          secondaryAction={{ label: t("Keep my edits"), disabled: saving, onClick: onKeepEdits }}
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
      <Row id="workspace-pinning" label={t("Pin workspaces")}>
        <Switch
          aria-label={t("Pin workspaces")}
          checked={draft.pinned}
          disabled={saving}
          onCheckedChange={(pinned) => update({ ...draft, pinned })}
        />
      </Row>
      <Row
        id="workspace-retention"
        label={t("Automatic cleanup")}
        info={t("Active and pinned workspaces are excluded")}
        stacked
      >
        <div className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-2">
          {retentionStates.map((state) => {
            const period = draft.retention[state];
            const label = lifecycleLabel(state);
            return (
              <div key={state} className="flex min-w-0 flex-col gap-1">
                <Text size="caption" tone="secondary" leading="inherit">
                  {label}
                </Text>
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
      </Row>
      <Row id="workspace-disk-policy" label={t("Limits")} stacked>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <Text size="caption" tone="secondary" leading="inherit">
              {t("Directory budget (GiB)")}
            </Text>
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
          <div className="flex min-w-0 flex-col gap-1">
            <Text size="caption" tone="secondary" leading="inherit">
              {t("Warn at (%)")}
            </Text>
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
          <div className="flex min-w-0 flex-col gap-1">
            <Text size="caption" tone="secondary" leading="inherit">
              {t("Minimum free space (GiB)")}
            </Text>
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
      </Row>
      <SettingsSaveBar
        id="workspace-policy"
        title={t("Defaults for new workspaces")}
        changes={changes}
        pending={saving}
        saved={saved}
        canSave={!invalidDisk && !loading && !policyConflict}
        discardEnabled={dirty && !loading}
        onDiscard={discardDraft}
        onSave={() => save()}
      />
    </Group>
  );
}
