import { useId, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { NumberField } from "../../../shared/ui/NumberField";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Select } from "../../../shared/ui/Select";
import { Toggle } from "../../settings/ui/settingsControls";
import type { CrewAgent, CrewPolicy } from "../model/crew";
import {
  COST_LEVELS,
  QUALITY_LEVELS,
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

/** A compact titled block of settings; blocks are separated by spacing, not frames. */
function Section({
  title,
  description,
  info,
  children,
}: {
  title: string;
  /** Explanation behind an info icon, one paragraph per entry. */
  description?: string | string[];
  info?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  const paragraphs = description ? [description].flat() : [];
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center gap-1">
        <h3 id={headingId} className="text-ui-caption font-medium text-(--ui-text-secondary)">
          {title}
        </h3>
        {info}
        {paragraphs.length ? (
          <InfoPopover label={t("About {p0}", { p0: title })}>
            {paragraphs.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </InfoPopover>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-2.5">{children}</div>
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
          {description ? (
            <InfoPopover label={t("About {p0}", { p0: label })}>
              <p>{description}</p>
            </InfoPopover>
          ) : null}
        </div>
      </div>
      <div
        role="group"
        aria-labelledby={labelId}
        className={`flex min-w-0 items-center gap-2 [&_.bycoda-arc-select]:min-h-(--ui-control-height-compact) [&_.bycoda-arc-select]:py-0 [&_.bycoda-arc]:[--control-height-md:var(--ui-control-height-compact)] ${stacked ? "" : "min-w-28 shrink-0 justify-end"}`}
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
 * The crew's advanced settings in two compact columns: model rules, execution limits,
 * appearance and maintenance. Permissions and bulk models live above the roster. Everything
 * except appearance is part of the crew draft. The draft stays with the editor; this
 * component only edits it. It lays out inside the editor's `crew-editor` container.
 */
export function CrewWorkingSettings({
  agents,
  policy,
  errors,
  onPolicyChange,
  appearance,
  appearanceSavedNow,
  appearanceOnHost = false,
  maintenance,
}: {
  agents: CrewAgent[];
  policy: CrewPolicy;
  errors: CrewPolicyErrors;
  onPolicyChange: (patch: Partial<CrewPolicy>) => void;
  /** The appearance picker, owned by the editor. */
  appearance: ReactNode;
  /** Existing crew: appearance is already stored on this device; a new crew saves it on create. */
  appearanceSavedNow: boolean;
  /** Existing crew on a host that stores the look with the crew, shared by every device. */
  appearanceOnHost?: boolean;
  /** Copy and delete actions, owned by the editor. */
  maintenance?: ReactNode;
}) {
  useLocale();
  const automatic = agents.filter((agent) => agent.selection === "automatic").length;
  const impact = crewPolicyImpact(agents, policy);
  const customWeights = policy.costWeight !== undefined || policy.qualityWeight !== undefined;

  const levelSelect = (
    key: "maxEstimatedCost" | "minimumQuality",
    label: string,
    levels: readonly number[],
    names: string[],
  ) => {
    const current = policy[key];
    return (
      <Select
        hideLabel
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

  const rankingNote = customWeights
    ? t("Custom weights are active. Choose a preset to reset them.")
    : policy.preset === "economy"
      ? t("Prefers models you rated cheaper.")
      : policy.preset === "quality"
        ? t("Prefers models you rated higher quality.")
        : t("Weighs cost and quality equally.");

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid min-w-0 gap-x-10 gap-y-5 @min-[48rem]/crew-editor:grid-cols-2">
        <Section
          title={t("Models")}
          description={[
            t(
              "These settings belong to the crew. They apply to work you start afterwards; work already started keeps its own.",
            ),
            t(
              "Rules apply first, to every member including fixed models. A fixed model that fails a rule is not used.",
            ),
          ]}
        >
          {eligibilityFeedback}
          <Line
            label={t("Highest cost allowed")}
            info={
              <InfoPopover label={t("About the cost limit")}>
                <p>
                  {t(
                    "Cost is the relative rating you give each model (Low, Medium, High), not a price in any currency.",
                  )}
                </p>
                <p>
                  {t(
                    "This one limit does two things: it skips every model rated above it, and it caps the combined estimate of the worker and reviewer assignments in one work.",
                  )}
                </p>
                <p>{t("When it is set, models without a cost rating are skipped.")}</p>
              </InfoPopover>
            }
          >
            {levelSelect("maxEstimatedCost", t("Highest cost allowed"), COST_LEVELS, costNames())}
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
            label={t("Automatic ranking")}
            description={
              automatic === 1
                ? `${t("Used by the member set to Automatic.")} ${rankingNote}`
                : automatic
                  ? `${t("Used by {p0} members set to Automatic.", { p0: automatic })} ${rankingNote}`
                  : t("No member chooses its model automatically. This applies once one does.")
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
        </Section>

        <div className="flex min-w-0 flex-col gap-5">
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
              label={t("Assignments per work")}
              description={t("The most assignments the coordinator can hand out for one work.")}
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
          <Section title={t("Appearance")}>
            <Line
              label={t("Crew icon and color")}
              description={
                appearanceOnHost
                  ? t("Saved with the crew and shown on every device.")
                  : appearanceSavedNow
                    ? t("Saved on this device right away.")
                    : t("Saved with the crew when you create it.")
              }
            >
              {appearance}
            </Line>
          </Section>
          {maintenance}
        </div>
      </div>
    </div>
  );
}
