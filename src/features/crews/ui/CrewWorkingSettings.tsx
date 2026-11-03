import { useId, useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Button } from "../../../shared/ui/Button";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { NumberField } from "../../../shared/ui/NumberField";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Select } from "../../../shared/ui/Select";
import { ChevronDown, ChevronRight } from "../../../shared/ui/icons";
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

function memberNames(effects: MemberPolicyEffect[], withShare = false) {
  return shortNameList(
    effects.map(({ agent, eligible, pool }) => {
      const name = agent.name || t("Unnamed member");
      return withShare ? `${name} (${eligible}/${pool})` : name;
    }),
  );
}

function costNames() {
  return [t("Low"), t("Medium"), t("High")];
}

function qualityNames() {
  return [t("Basic"), t("Good"), t("Best")];
}

function levelName(levels: readonly number[], names: string[], value: number) {
  const index = levels.indexOf(value);
  return index >= 0 ? names[index]! : t("Custom ({p0})", { p0: value });
}

/** A compact titled block of settings; blocks are separated by spacing, not frames. */
function Section({
  title,
  description,
  info,
  children,
}: {
  title: string;
  description?: string;
  info?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1">
          <h3 id={headingId} className="text-ui-body font-semibold">
            {title}
          </h3>
          {info}
        </div>
        {description ? (
          <p className="text-ui-caption text-(--ui-text-secondary)">{description}</p>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </section>
  );
}

/**
 * One setting: label and description on the left, the control close to it on the
 * right (or under the label for wide controls). The whole block stays inside its
 * column, so a label and its control are never pushed to opposite ends of a dialog.
 */
function Line({
  label,
  description,
  info,
  stacked = false,
  children,
}: {
  label: string;
  description?: string;
  info?: ReactNode;
  stacked?: boolean;
  children: ReactNode;
}) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <div
      className={`flex min-w-0 gap-x-3 gap-y-1.5 ${stacked ? "flex-col" : "flex-wrap items-center justify-between"}`}
    >
      <div className={`min-w-0 ${stacked ? "" : "flex-1 basis-40"}`}>
        <div className="flex min-w-0 items-center gap-1">
          <span id={labelId} className="text-ui-secondary">
            {label}
          </span>
          {info}
        </div>
        {description ? (
          <p id={descriptionId} className="text-ui-caption text-(--ui-text-secondary)">
            {description}
          </p>
        ) : null}
      </div>
      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        className={`flex min-w-0 items-center gap-2 [&_.bycoda-arc-select]:min-h-(--ui-control-height-compact) [&_.bycoda-arc-select]:py-0 [&_.bycoda-arc]:[--control-height-md:var(--ui-control-height-compact)] ${stacked ? "" : "shrink-0"}`}
      >
        {children}
      </div>
    </div>
  );
}

/** A whole-number limit. An error moves the field under its label so the message has room. */
function LimitLine({
  label,
  description,
  min,
  max,
  value,
  error,
  onChange,
}: {
  label: string;
  description: string;
  min: number;
  max: number;
  value: number;
  error: string;
  onChange: (value: number) => void;
}) {
  return (
    <Line label={label} description={description} stacked={!!error}>
      <div className={error ? "w-full max-w-72" : "w-28"}>
        <NumberField
          label={label}
          hideLabel
          min={min}
          max={max}
          value={value}
          error={error || undefined}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    </Line>
  );
}

/**
 * The crew's working settings in two compact columns: how models are chosen (with its
 * rules on demand and the bulk fixed-model action), execution limits and permissions,
 * then appearance and maintenance. Everything except appearance is part of the crew
 * draft and applies when the crew is saved. The draft stays with the editor; this
 * component only edits it. It lays out inside the editor's `crew-editor` container.
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
  const customWeights = policy.costWeight !== undefined || policy.qualityWeight !== undefined;
  // Rules that differ from the defaults start open; otherwise they open on demand.
  const [rulesOpen, setRulesOpen] = useState(
    () => guardsActive || customWeights || policy.preset !== "balanced",
  );

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

  const guards = [
    policy.maxEstimatedCost !== undefined
      ? t("Cost up to {p0}", {
          p0: levelName(COST_LEVELS, costNames(), policy.maxEstimatedCost),
        })
      : "",
    policy.minimumQuality !== undefined
      ? t("Quality at least {p0}", {
          p0: levelName(QUALITY_LEVELS, qualityNames(), policy.minimumQuality),
        })
      : "",
    !policy.allowUnknownCost ? t("Unrated models skipped") : "",
  ].filter(Boolean);
  const presetLabel =
    policy.preset === "economy"
      ? t("Economy")
      : policy.preset === "quality"
        ? t("Quality")
        : t("Balanced");

  // Every catalog ends this caption with its name list, so an empty list leaves the lead-in.
  const narrowedLead = t("Fewer candidates (eligible/total): {p0}", { p0: "" }).trimEnd();
  const eligibilityFeedback =
    impact.blocked.length || impact.narrowed.length ? (
      <div className="flex min-w-0 flex-col gap-1.5">
        {impact.blocked.length ? (
          <Alert tone="warning">
            {t("No eligible model left for: {p0}. Fixed models are not exempt.", {
              p0: memberNames(impact.blocked),
            })}
          </Alert>
        ) : null}
        {impact.narrowed.length ? (
          <div className="flex min-w-0 flex-col gap-1 text-ui-caption text-(--ui-text-secondary)">
            <span>{narrowedLead}</span>
            <BadgeList
              label={narrowedLead.replace(/\s*[:：]$/, "")}
              size="xs"
              max={5}
              items={impact.narrowed.map(({ agent, eligible, pool }) => ({
                id: agent.id,
                label: `${agent.name || t("Unnamed member")} (${eligible}/${pool})`,
              }))}
            />
          </div>
        ) : null}
      </div>
    ) : null;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <p className="text-ui-caption text-(--ui-text-secondary)">
        {t(
          "These settings belong to the crew. They apply when you save and to work you start afterwards; work already started keeps its own.",
        )}
      </p>
      <div className="grid min-w-0 max-w-xl gap-x-10 gap-y-6 @min-[48rem]/crew-editor:max-w-none @min-[48rem]/crew-editor:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-6">
          <Section
            title={t("Models")}
            description={t(
              "Rules apply first, to every member including fixed models. A fixed model that fails a rule is not used.",
            )}
          >
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-ui-caption text-(--ui-text-secondary)">
                {guards.length
                  ? t("Eligibility: {p0}", { p0: guards.join(" · ") })
                  : t("Eligibility: no limits, any model can be used.")}
              </p>
              <p className="text-ui-caption text-(--ui-text-secondary)">
                {customWeights
                  ? t("Automatic ranking: custom weights.")
                  : automatic
                    ? t("Automatic ranking: {p0}.", { p0: presetLabel })
                    : t("Automatic ranking applies once a member is set to Automatic.")}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                aria-expanded={rulesOpen}
                startIcon={rulesOpen ? <ChevronDown /> : <ChevronRight />}
                onClick={() => setRulesOpen((open) => !open)}
              >
                {rulesOpen ? t("Hide model rules") : t("Edit model rules")}
              </Button>
            </div>
            {eligibilityFeedback}
            {rulesOpen ? (
              <div className="flex min-w-0 flex-col gap-3">
                <Line
                  label={t("Highest cost allowed")}
                  description={t(
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
                  {levelSelect(
                    "maxEstimatedCost",
                    t("Highest cost allowed"),
                    COST_LEVELS,
                    costNames(),
                  )}
                </Line>
                <Line
                  label={t("Lowest quality allowed")}
                  description={t("Models rated below this quality are skipped.")}
                >
                  {levelSelect(
                    "minimumQuality",
                    t("Lowest quality allowed"),
                    QUALITY_LEVELS,
                    qualityNames(),
                  )}
                </Line>
                <Line
                  label={t("Use models without a cost rating")}
                  description={t("When off, only models you rated for cost can be chosen.")}
                >
                  <Toggle
                    label={t("Use models without a cost rating")}
                    on={policy.allowUnknownCost}
                    onChange={(value) => onPolicyChange({ allowUnknownCost: value })}
                  />
                </Line>
                <Line
                  stacked
                  label={t("Automatic ranking")}
                  description={
                    automatic === 1
                      ? t("Used by the member set to Automatic.")
                      : automatic
                        ? t("Used by {p0} members set to Automatic.", { p0: automatic })
                        : t(
                            "No member chooses its model automatically. This applies once one does.",
                          )
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
                </Line>
                <p className="text-ui-caption text-(--ui-text-secondary)">
                  {customWeights
                    ? t("Custom weights are active. Choose a preset to reset them.")
                    : policy.preset === "economy"
                      ? t("Prefers models you rated cheaper.")
                      : policy.preset === "quality"
                        ? t("Prefers models you rated higher quality.")
                        : t("Weighs cost and quality equally.")}
                </p>
              </div>
            ) : null}
            {fixed.length ? (
              <Line
                stacked
                label={t("Same model for every fixed member")}
                description={
                  bulkApplied !== null
                    ? t("Applied to {p0} fixed members. Save to keep it.", { p0: bulkApplied })
                    : t("Replaces the model of {p0} members with a fixed model.", {
                        p0: fixed.length,
                      })
                }
              >
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <div className="min-w-40 flex-1">
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
                  </div>
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
                    {fixed.length === 1
                      ? t("Apply to 1 member")
                      : t("Apply to {p0} members", { p0: fixed.length })}
                  </Button>
                </div>
              </Line>
            ) : null}
          </Section>

          <Section title={t("Appearance")}>
            <Line
              label={t("Crew icon and color")}
              description={
                appearanceSavedNow
                  ? t("Saved on this device right away. Discard does not undo it.")
                  : t("Saved with the crew when you create it.")
              }
            >
              {appearance}
            </Line>
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Section title={t("Execution limits")}>
            <LimitLine
              label={t("Members working at once")}
              description={t("How many assignments can run at the same time.")}
              min={1}
              max={4}
              value={policy.maxParallel}
              error={errors.maxParallel}
              onChange={(value) => onPolicyChange({ maxParallel: value })}
            />
            <LimitLine
              label={t("Assignments per job")}
              description={t("The most assignments the coordinator can hand out for one job.")}
              min={1}
              max={20}
              value={policy.maxAssignments}
              error={errors.maxAssignments}
              onChange={(value) => onPolicyChange({ maxAssignments: value })}
            />
            <LimitLine
              label={t("Minutes per assignment")}
              description={t("An assignment running longer than this is stopped.")}
              min={1}
              max={240}
              value={policy.maxRunMinutes}
              error={errors.maxRunMinutes}
              onChange={(value) => onPolicyChange({ maxRunMinutes: value })}
            />
          </Section>

          <Section title={t("Permissions")}>
            <Line
              label={t("Coordinator answers permission requests")}
              description={
                policy.delegateApprovals === true
                  ? t("On: the coordinator may answer a member's open permission request.")
                  : t("Off: only you answer permission requests.")
              }
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
            </Line>
            <Line
              label={t("Allow provider sub-agents")}
              description={
                policy.allowSubagents
                  ? t("On: members may use their provider's own helper agents and report it.")
                  : t("Off: members are told not to start helper agents.")
              }
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
            </Line>
          </Section>
        </div>
      </div>
      {maintenance}
    </div>
  );
}
