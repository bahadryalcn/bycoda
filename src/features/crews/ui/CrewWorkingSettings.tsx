import type { ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { NumberField } from "../../../shared/ui/NumberField";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Select } from "../../../shared/ui/Select";
import { Toggle } from "../../settings/ui/settingsControls";
import type { HostModelCatalog } from "../../connections/model/protocol";
import type { CrewAgent, CrewPolicy } from "../model/crew";
import {
  COST_LEVELS,
  QUALITY_LEVELS,
  applyFixedModel,
  catalogCandidate,
  catalogModels,
  crewPolicyImpact,
  shortNameList,
  type MemberPolicyEffect,
} from "../model/crewRoster";

export type CrewPolicyErrors = {
  maxParallel: string;
  maxAssignments: string;
  maxRunMinutes: string;
};

function Section({
  title,
  info,
  lead,
  children,
}: {
  title: string;
  info?: ReactNode;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1">
        <h4 className="min-w-0 text-ui-body font-medium">{title}</h4>
        {info}
      </div>
      {lead ? <p className="text-ui-caption text-(--ui-text-secondary)">{lead}</p> : null}
      <div className="flex min-w-0 flex-col divide-y divide-(--ui-tone-neutral-border)">
        {children}
      </div>
    </section>
  );
}

/** A label with its visible consequence on the left and the control on the right; stacks when narrow. */
function SettingRow({
  label,
  hint,
  info,
  children,
}: {
  label: string;
  hint?: string;
  info?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 items-center gap-x-4 gap-y-1.5 py-2 @min-[32rem]/crew-editor:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 text-ui-body">{label}</span>
          {info}
        </div>
        {hint ? <p className="text-ui-caption text-(--ui-text-secondary)">{hint}</p> : null}
      </div>
      <div className="flex min-w-0 items-center gap-2 @min-[32rem]/crew-editor:justify-end">
        {children}
      </div>
    </div>
  );
}

function memberNames(effects: MemberPolicyEffect[], withShare = false) {
  return shortNameList(
    effects.map(({ agent, eligible, pool }) => {
      const name = agent.name || t("Unnamed member");
      return withShare ? `${name} (${eligible}/${pool})` : name;
    }),
  );
}

/**
 * The crew's working settings in one compact column: who may be used (eligibility,
 * for every member), how automatic members are ranked, the bulk fixed-model
 * action, execution limits and permissions. Appearance and maintenance sit last.
 * The draft stays with the editor; this component only edits it.
 */
export function CrewWorkingSettings({
  catalog,
  agents,
  policy,
  errors,
  onPolicyChange,
  onAgentsChange,
  bulkModel,
  onBulkModelChange,
  bulkApplied,
  onBulkApplied,
  appearance,
  appearanceSavedNow,
  maintenance,
}: {
  catalog: HostModelCatalog;
  agents: CrewAgent[];
  policy: CrewPolicy;
  errors: CrewPolicyErrors;
  onPolicyChange: (patch: Partial<CrewPolicy>) => void;
  onAgentsChange: (agents: CrewAgent[]) => void;
  bulkModel: string;
  onBulkModelChange: (value: string) => void;
  /** How many fixed members the last Apply changed in this unsaved draft. */
  bulkApplied: number | null;
  onBulkApplied: (count: number | null) => void;
  /** The appearance picker, owned by the editor. */
  appearance: ReactNode;
  /** Existing crew: appearance is already stored on this device; a new crew saves it on create. */
  appearanceSavedNow: boolean;
  /** Copy and delete actions, owned by the editor. */
  maintenance?: ReactNode;
}) {
  useLocale();
  const fixed = agents.filter((agent) => agent.selection === "fixed");
  const automatic = agents.filter((agent) => agent.selection === "automatic").length;
  const modelOptions = catalogModels(catalog).map((model) => ({
    value: `${model.harness}/${model.id}`,
    label: model.name,
    description: model.harness,
  }));
  const impact = crewPolicyImpact(agents, policy);
  const guardsActive =
    !policy.allowUnknownCost ||
    policy.maxEstimatedCost !== undefined ||
    policy.minimumQuality !== undefined;

  const levelSelect = (
    key: "maxEstimatedCost" | "minimumQuality",
    label: string,
    levels: readonly number[],
    names: string[],
  ) => {
    const current = policy[key];
    return (
      <Select
        label={label}
        value={current === undefined ? "" : String(current)}
        options={[
          { value: "", label: t("Any") },
          ...levels.map((level, index) => ({ value: String(level), label: names[index]! })),
          ...(current !== undefined && !levels.includes(current)
            ? [{ value: String(current), label: t("Custom ({p0})", { p0: current }) }]
            : []),
        ]}
        onValueChange={(value) => onPolicyChange({ [key]: value ? Number(value) : undefined })}
      />
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Section
        title={t("Model eligibility")}
        lead={t(
          "Applied first, to every member including fixed models. A fixed model that fails a guard is not used.",
        )}
      >
        <SettingRow
          label={t("Highest cost allowed")}
          hint={t(
            "A relative rating, not money. Skips models rated above it and caps a job's combined worker and reviewer estimate.",
          )}
          info={
            <InfoPopover label={t("About the cost limit")}>
              <p>
                {t(
                  "Cost is the relative rating you give each model (Low, Medium, High), not a price in any currency.",
                )}
              </p>
              <p>
                {t(
                  "This one limit does two things: it skips every model rated above it, and it caps the combined estimate of the worker and reviewer assignments in one job.",
                )}
              </p>
              <p>{t("When it is set, models without a cost rating are skipped.")}</p>
            </InfoPopover>
          }
        >
          {levelSelect("maxEstimatedCost", t("Highest cost allowed"), COST_LEVELS, [
            t("Low"),
            t("Medium"),
            t("High"),
          ])}
        </SettingRow>
        <SettingRow
          label={t("Lowest quality allowed")}
          hint={t("Models rated below this quality are skipped.")}
        >
          {levelSelect("minimumQuality", t("Lowest quality allowed"), QUALITY_LEVELS, [
            t("Basic"),
            t("Good"),
            t("Best"),
          ])}
        </SettingRow>
        <SettingRow
          label={t("Use models without a cost rating")}
          hint={t("When off, only models you rated for cost can be chosen.")}
        >
          <Toggle
            label={t("Use models without a cost rating")}
            on={policy.allowUnknownCost}
            onChange={(value) => onPolicyChange({ allowUnknownCost: value })}
          />
        </SettingRow>
        {impact.blocked.length || impact.narrowed.length || (guardsActive && agents.length) ? (
          <div className="flex min-w-0 flex-col gap-1.5 py-2">
            {impact.blocked.length ? (
              <Alert tone="warning">
                {t("No eligible model left for: {p0}. Fixed models are not exempt.", {
                  p0: memberNames(impact.blocked),
                })}
              </Alert>
            ) : null}
            {impact.narrowed.length ? (
              <p className="text-ui-caption text-(--ui-text-secondary)">
                {t("Fewer candidates (eligible/total): {p0}", {
                  p0: memberNames(impact.narrowed, true),
                })}
              </p>
            ) : null}
            {!impact.blocked.length && !impact.narrowed.length ? (
              <p className="text-ui-caption text-(--ui-text-secondary)">
                {t("Every member keeps its models under these guards.")}
              </p>
            ) : null}
          </div>
        ) : null}
      </Section>

      <Section
        title={t("Automatic ranking")}
        lead={
          automatic === 1
            ? t("Used by the member set to Automatic.")
            : automatic
              ? t("Used by {p0} members set to Automatic.", { p0: automatic })
              : t("No member chooses its model automatically. These apply once one does.")
        }
      >
        <SettingRow
          label={t("Priority")}
          hint={
            policy.preset === "economy"
              ? t("Prefers models you rated cheaper.")
              : policy.preset === "quality"
                ? t("Prefers models you rated higher quality.")
                : t("Weighs cost and quality equally.")
          }
        >
          <SegmentedControl
            label={t("Priority")}
            value={policy.preset}
            options={[
              { value: "economy", label: t("Economy") },
              { value: "balanced", label: t("Balanced") },
              { value: "quality", label: t("Quality") },
            ]}
            onValueChange={(preset) =>
              // A preset deliberately resets any custom weights.
              onPolicyChange({
                preset: preset as CrewPolicy["preset"],
                costWeight: undefined,
                qualityWeight: undefined,
              })
            }
          />
        </SettingRow>
        {policy.costWeight !== undefined || policy.qualityWeight !== undefined ? (
          <p className="py-2 text-ui-caption text-(--ui-text-secondary)">
            {t("Custom weights are active. Choose a preset to reset them.")}
          </p>
        ) : null}
      </Section>

      {fixed.length ? (
        <Section title={t("Models")}>
          <SettingRow
            label={t("Same model for every fixed member")}
            hint={
              bulkApplied !== null
                ? t("Applied to {p0} fixed members. Save to keep it.", { p0: bulkApplied })
                : t("Replaces the model of {p0} members with a fixed model.", {
                    p0: fixed.length,
                  })
            }
          >
            <SearchableSelect
              label={t("Same model for every fixed member")}
              options={modelOptions}
              value={bulkModel}
              placeholder={t("Choose a model")}
              onChange={(value) => {
                onBulkModelChange(value);
                onBulkApplied(null);
              }}
            />
            <Button
              variant="secondary"
              disabled={!bulkModel}
              onClick={() => {
                const next = catalogCandidate(catalog, bulkModel);
                if (!next) return;
                onAgentsChange(applyFixedModel(agents, next));
                onBulkModelChange("");
                onBulkApplied(fixed.length);
              }}
            >
              {t("Apply")}
            </Button>
          </SettingRow>
        </Section>
      ) : null}

      <Section title={t("Execution limits")}>
        <div className="grid min-w-0 gap-3 py-2 @min-[36rem]/crew-editor:grid-cols-3">
          <NumberField
            label={t("Members working at once")}
            description={t("How many assignments can run at the same time.")}
            min={1}
            max={4}
            value={policy.maxParallel}
            error={errors.maxParallel || undefined}
            onChange={(e) => onPolicyChange({ maxParallel: Number(e.target.value) })}
          />
          <NumberField
            label={t("Assignments per job")}
            description={t("The most assignments the coordinator can hand out for one job.")}
            min={1}
            max={20}
            value={policy.maxAssignments}
            error={errors.maxAssignments || undefined}
            onChange={(e) => onPolicyChange({ maxAssignments: Number(e.target.value) })}
          />
          <NumberField
            label={t("Minutes per assignment")}
            description={t("An assignment running longer than this is stopped.")}
            min={1}
            max={240}
            value={policy.maxRunMinutes}
            error={errors.maxRunMinutes || undefined}
            onChange={(e) => onPolicyChange({ maxRunMinutes: Number(e.target.value) })}
          />
        </div>
      </Section>

      <Section title={t("Permissions")}>
        <SettingRow
          label={t("Coordinator answers permission requests")}
          hint={t("When a member asks to run a tool, the coordinator decides instead of you.")}
          info={
            <InfoPopover label={t("About coordinator approvals")}>
              <p>
                {t(
                  "This is your grant for this crew's work. It is off until you turn it on and never changes by itself.",
                )}
              </p>
              <p>
                {t(
                  "Only the current coordinator can answer, and only for the request that is open now.",
                )}
              </p>
            </InfoPopover>
          }
        >
          <Toggle
            label={t("Coordinator answers permission requests")}
            on={policy.delegateApprovals === true}
            onChange={(value) => onPolicyChange({ delegateApprovals: value })}
          />
        </SettingRow>
        <SettingRow
          label={t("Allow provider sub-agents")}
          hint={t("Members may start their provider's own helper agents.")}
          info={
            <InfoPopover label={t("About provider sub-agents")}>
              <p>
                {t(
                  "Provider helper agents run inside the member's own session. This is a separate choice from coordinator approvals.",
                )}
              </p>
            </InfoPopover>
          }
        >
          <Toggle
            label={t("Allow provider sub-agents")}
            on={policy.allowSubagents}
            onChange={(value) => onPolicyChange({ allowSubagents: value })}
          />
        </SettingRow>
      </Section>

      <Section title={t("Appearance")}>
        <SettingRow
          label={t("Crew icon and color")}
          hint={
            appearanceSavedNow
              ? t("Saved on this device right away. Discard does not undo it.")
              : t("Saved with the crew when you create it.")
          }
        >
          {appearance}
        </SettingRow>
      </Section>
      {maintenance}
    </div>
  );
}
