import type { ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { NumberField } from "../../../shared/ui/NumberField";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Select } from "../../../shared/ui/Select";
import { Group, Row, Toggle } from "../../settings/ui/settingsControls";
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

  const eligibilityFeedback =
    impact.blocked.length || impact.narrowed.length || (guardsActive && agents.length) ? (
      <div className="flex min-w-0 flex-col gap-1.5">
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
    ) : undefined;

  return (
    <div className="settings-topics">
      <Group
        title={t("Model eligibility")}
        description={t(
          "Applied first, to every member including fixed models. A fixed model that fails a guard is not used.",
        )}
        descriptionVisible
        feedback={eligibilityFeedback}
      >
        <Row
          label={t("Highest cost allowed")}
          description={t(
            "A relative rating, not money. Skips models rated above it and caps a job's combined worker and reviewer estimate.",
          )}
          descriptionVisible
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
        </Row>
        <Row
          label={t("Lowest quality allowed")}
          description={t("Models rated below this quality are skipped.")}
          descriptionVisible
        >
          {levelSelect("minimumQuality", t("Lowest quality allowed"), QUALITY_LEVELS, [
            t("Basic"),
            t("Good"),
            t("Best"),
          ])}
        </Row>
        <Row
          label={t("Use models without a cost rating")}
          description={t("When off, only models you rated for cost can be chosen.")}
          descriptionVisible
        >
          <Toggle
            label={t("Use models without a cost rating")}
            on={policy.allowUnknownCost}
            onChange={(value) => onPolicyChange({ allowUnknownCost: value })}
          />
        </Row>
      </Group>

      <Group
        title={t("Automatic ranking")}
        description={
          automatic === 1
            ? t("Used by the member set to Automatic.")
            : automatic
              ? t("Used by {p0} members set to Automatic.", { p0: automatic })
              : t("No member chooses its model automatically. These apply once one does.")
        }
        descriptionVisible
        feedback={
          policy.costWeight !== undefined || policy.qualityWeight !== undefined ? (
            <p className="text-ui-caption text-(--ui-text-secondary)">
              {t("Custom weights are active. Choose a preset to reset them.")}
            </p>
          ) : undefined
        }
      >
        <Row
          label={t("Priority")}
          description={
            policy.preset === "economy"
              ? t("Prefers models you rated cheaper.")
              : policy.preset === "quality"
                ? t("Prefers models you rated higher quality.")
                : t("Weighs cost and quality equally.")
          }
          descriptionVisible
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
        </Row>
      </Group>

      {fixed.length ? (
        <Group title={t("Models")}>
          <Row
            stacked
            label={t("Same model for every fixed member")}
            description={
              bulkApplied !== null
                ? t("Applied to {p0} fixed members. Save to keep it.", { p0: bulkApplied })
                : t("Replaces the model of {p0} members with a fixed model.", {
                    p0: fixed.length,
                  })
            }
            descriptionVisible
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
          </Row>
        </Group>
      ) : null}

      <Group title={t("Execution limits")}>
        <Row
          label={t("Members working at once")}
          description={t("How many assignments can run at the same time.")}
          descriptionVisible
        >
          <NumberField
            label={t("Members working at once")}
            hideLabel
            min={1}
            max={4}
            value={policy.maxParallel}
            error={errors.maxParallel || undefined}
            onChange={(e) => onPolicyChange({ maxParallel: Number(e.target.value) })}
          />
        </Row>
        <Row
          label={t("Assignments per job")}
          description={t("The most assignments the coordinator can hand out for one job.")}
          descriptionVisible
        >
          <NumberField
            label={t("Assignments per job")}
            hideLabel
            min={1}
            max={20}
            value={policy.maxAssignments}
            error={errors.maxAssignments || undefined}
            onChange={(e) => onPolicyChange({ maxAssignments: Number(e.target.value) })}
          />
        </Row>
        <Row
          label={t("Minutes per assignment")}
          description={t("An assignment running longer than this is stopped.")}
          descriptionVisible
        >
          <NumberField
            label={t("Minutes per assignment")}
            hideLabel
            min={1}
            max={240}
            value={policy.maxRunMinutes}
            error={errors.maxRunMinutes || undefined}
            onChange={(e) => onPolicyChange({ maxRunMinutes: Number(e.target.value) })}
          />
        </Row>
      </Group>

      <Group title={t("Permissions")}>
        <Row
          label={t("Coordinator answers permission requests")}
          description={t(
            "When a member asks to run a tool, the coordinator decides instead of you.",
          )}
          descriptionVisible
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
        </Row>
        <Row
          label={t("Allow provider sub-agents")}
          description={t("Members may start their provider's own helper agents.")}
          descriptionVisible
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
        </Row>
      </Group>

      <Group title={t("Appearance")}>
        <Row
          stacked
          label={t("Crew icon and color")}
          description={
            appearanceSavedNow
              ? t("Saved on this device right away. Discard does not undo it.")
              : t("Saved with the crew when you create it.")
          }
          descriptionVisible
        >
          {appearance}
        </Row>
      </Group>
      {maintenance}
    </div>
  );
}
