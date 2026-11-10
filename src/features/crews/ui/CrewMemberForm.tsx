import { useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Select } from "../../../shared/ui/Select";
import { TagInput } from "../../../shared/ui/TagInput";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { ChevronDown, ChevronRight } from "../../../shared/ui/icons";
import { Toggle } from "../../settings/ui/settingsControls";
import type { HostModelCatalog } from "../../connections/model/protocol";
import type { CrewAgent, CrewCandidate, CrewPolicy, CrewRole } from "../model/crew";
import {
  COST_LEVELS,
  QUALITY_LEVELS,
  candidateDetailLabel,
  candidateLabel,
  candidatePassesPolicy,
  catalogCandidate,
  catalogModels,
  memberCandidatePool,
  memberModelSummary,
} from "../model/crewRoster";
import type { MemberAvatarTraits } from "../model/memberAvatarTraits";
import { memberTraits } from "../model/memberAvatars";
import { CrewRoleIcon } from "./CrewRoleIcon";
import { MemberAppearancePicker } from "./MemberAppearancePicker";
import { MemberHandleField } from "./MemberHandleField";
import { MemberModelPicker } from "./MemberModelPicker";
import { MemberToolsPicker } from "./MemberToolsPicker";

export function roleLabel(role: CrewRole) {
  return role === "coordinator"
    ? t("Coordinator")
    : role === "reviewer"
      ? t("Reviewer")
      : role === "advisor"
        ? t("Advisor")
        : t("Specialist");
}

export function responsibilityHint(role: CrewRole) {
  return role === "coordinator"
    ? t("Plans the work and hands out assignments. A crew has one.")
    : role === "reviewer"
      ? t("Checks each delivery independently. A crew has one.")
      : role === "advisor"
        ? t("Answers the team's questions without taking assignments.")
        : t("Does the assigned work. Add as many as you need.");
}

/** Common role names; the owner can type any other. */
export function roleSuggestions(role: CrewRole): string[] {
  return role === "coordinator"
    ? [t("Project lead"), t("Tech lead"), t("Product manager")]
    : role === "reviewer"
      ? [t("Code reviewer"), t("QA reviewer"), t("Security reviewer")]
      : role === "advisor"
        ? [t("Architect"), t("Domain expert"), t("Security advisor")]
        : [
            t("Frontend developer"),
            t("Backend developer"),
            t("Mobile developer"),
            t("UI designer"),
            t("Test engineer"),
            t("Technical writer"),
          ];
}

function levelOptions(levels: readonly number[], labels: string[], current?: number) {
  return [
    { value: "", label: t("Not rated") },
    ...levels.map((level, index) => ({ value: String(level), label: labels[index]! })),
    ...(current !== undefined && !levels.includes(current)
      ? [{ value: String(current), label: t("Custom ({p0})", { p0: current }) }]
      : []),
  ];
}

/**
 * One member: a name of the owner's choosing (a professional role works too), its
 * responsibility in the crew, instructions and model. Ratings only appear where
 * automatic selection uses them.
 */
export function CrewMemberForm({
  cwd,
  catalog,
  agent,
  onChange,
  groups,
  identity,
  tools,
  handleError,
  traits,
  groupSuggestions = [],
  nameError,
  modelError,
  advancedExtra,
  autoFocus,
  policy,
  compact = false,
}: {
  cwd: string;
  catalog: HostModelCatalog;
  agent: CrewAgent;
  onChange: (patch: Partial<CrewAgent>) => void;
  /** Shown when the host keeps specialty groups. */
  groups?: boolean;
  /** Shown when the host keeps member handles and avatar choices. */
  identity?: boolean;
  /** Shown when the host enforces member tool profiles. */
  tools?: boolean;
  /** A Host refusal about the handle, shown under its field. */
  handleError?: string;
  /** The look to preview when it depends on the roster (see `teamTraits`); defaults to the member alone. */
  traits?: MemberAvatarTraits;
  groupSuggestions?: string[];
  nameError?: string;
  /** Shown under the model choice when no model is selected (save was attempted). */
  modelError?: string;
  advancedExtra?: ReactNode;
  autoFocus?: boolean;
  /** The crew's working limits, when the member belongs to a crew; used to say what applies. */
  policy?: Pick<CrewPolicy, "allowUnknownCost" | "maxEstimatedCost" | "minimumQuality">;
  /** Inside a roster row: the row already edits the role and the pinned model. */
  compact?: boolean;
}) {
  useLocale();
  const [advanced, setAdvanced] = useState(false);
  const options = catalogModels(catalog).map((model) => ({
    value: `${model.harness}/${model.id}`,
    label: model.name,
    description: model.harness,
  }));
  const updateCandidate = (id: string, patch: Partial<CrewCandidate>) =>
    onChange({
      candidates: agent.candidates.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  const pool = memberCandidatePool(agent);
  const eligible = policy
    ? pool.filter((candidate) => candidatePassesPolicy(candidate, policy)).length
    : pool.length;
  const suggestions = agent.name.trim()
    ? []
    : roleSuggestions(agent.role).filter((name) => name !== agent.name);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <TextField
          label={t("Member name")}
          description={t("Any name or professional role.")}
          placeholder={t("e.g. Frontend developer")}
          value={agent.name}
          autoFocus={autoFocus}
          error={nameError}
          maxLength={200}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        {suggestions.length ? (
          <div role="group" aria-label={t("Suggested roles")} className="flex flex-wrap gap-1">
            {suggestions.map((name) => (
              <Button
                key={name}
                size="sm"
                variant="secondary"
                shape="pill"
                onClick={() => onChange({ name })}
              >
                {name}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      {compact ? null : (
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-ui-body font-medium">{t("Responsibility in the crew")}</span>
          <SegmentedControl
            label={t("Responsibility in the crew")}
            value={agent.role}
            options={(["coordinator", "specialist", "reviewer", "advisor"] as const).map(
              (role) => ({
                value: role,
                label: roleLabel(role),
              }),
            )}
            onValueChange={(role) => onChange({ role: role as CrewRole })}
          />
          <p className="flex min-w-0 items-start gap-1.5 text-ui-caption text-(--ui-text-secondary)">
            <CrewRoleIcon role={agent.role} className="icon-xs mt-0.5 shrink-0" />
            <span className="min-w-0">{responsibilityHint(agent.role)}</span>
          </p>
        </div>
      )}
      {identity ? (
        <>
          <MemberHandleField
            value={agent.handle}
            hostError={handleError}
            onChange={(handle) => onChange({ handle })}
          />
          <MemberAppearancePicker
            traits={traits ?? memberTraits(agent)}
            chosen={!!agent.avatar}
            onChange={(avatar) => onChange({ avatar })}
          />
        </>
      ) : null}
      {tools ? (
        <MemberToolsPicker value={agent.tools} onChange={(next) => onChange({ tools: next })} />
      ) : null}
      <TextareaField
        label={t("Instructions")}
        placeholder={t("e.g. Build accessible screens and follow the design system.")}
        value={agent.instructions}
        rows={3}
        onChange={(event) => onChange({ instructions: event.target.value })}
      />
      {groups ? (
        <TagInput
          label={t("Groups")}
          placeholder={t("UI, Mobile, Backend…")}
          value={agent.groups ?? []}
          normalize={(values) => [
            ...new Set(values.map((value) => value.trim().slice(0, 40)).filter(Boolean)),
          ]}
          maxTags={12}
          description={
            groupSuggestions.length
              ? t("Existing groups: {p0}", { p0: groupSuggestions.slice(0, 8).join(", ") })
              : t("Groups help you find this member in the library, e.g. UI or Mobile.")
          }
          onValueChange={(next) => onChange({ groups: next.length ? next : undefined })}
        />
      ) : null}
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-ui-body font-medium">{t("Model")}</span>
          <SegmentedControl
            label={t("Model choice")}
            value={agent.selection}
            options={[
              { value: "fixed", label: t("Fixed model") },
              { value: "automatic", label: t("Automatic") },
            ]}
            onValueChange={(value) => onChange({ selection: value as CrewAgent["selection"] })}
          />
        </div>
        <p className="text-ui-caption text-(--ui-text-secondary)">
          {agent.selection === "fixed"
            ? compact
              ? t("Always works with the model chosen in its row.")
              : t("Always works with the model chosen below.")
            : t("For each assignment the crew picks one of the allowed models below.")}
          {policy && pool.length
            ? ` ${
                eligible === pool.length
                  ? pool.length === 1
                    ? t("It passes the crew's limits.")
                    : t("All {p0} pass the crew's limits.", { p0: pool.length })
                  : eligible
                    ? t("{p0} of {p1} pass the crew's limits.", { p0: eligible, p1: pool.length })
                    : t("The crew's limits exclude every model here, so this member cannot work.")
              }`
            : ""}
        </p>
        {agent.selection === "fixed" ? (
          compact ? null : (
            <MemberModelPicker
              cwd={cwd}
              value={agent.candidates[0]}
              onChange={(next) =>
                onChange({
                  candidates: [next, ...agent.candidates.slice(1).filter((c) => c.id !== next.id)],
                })
              }
            />
          )
        ) : (
          <>
            <p className="text-ui-caption text-(--ui-text-secondary)">
              <span className="font-medium">{memberModelSummary(catalog, agent)}</span>
              {" · "}
              {t("Your ratings and the crew's priority decide which one is used.")}
            </p>
            <SearchableSelect
              hideLabel
              label={t("Allowed models")}
              multiple
              options={options}
              placeholder={t("Choose models")}
              value={agent.candidates.map((c) => c.id)}
              onChange={(values) =>
                onChange({
                  candidates: values.flatMap((value) => {
                    const c =
                      agent.candidates.find((item) => item.id === value) ??
                      catalogCandidate(catalog, value);
                    return c ? [c] : [];
                  }),
                })
              }
            />
            {agent.candidates.length ? (
              <ul
                aria-label={t("Model ratings")}
                className="flex flex-col gap-1 rounded-(--ui-radius-card) border border-(--ui-pane-border) p-1"
              >
                {agent.candidates.map((c) => {
                  const model = catalogModels(catalog).find(
                    (m) => m.harness === c.harness && m.id === c.model,
                  );
                  // Provider-qualified, so equal model names from two providers stay distinct.
                  const name = candidateDetailLabel(catalog, c);
                  return (
                    <li key={c.id} className="flex min-w-0 flex-col gap-2 px-3 py-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 text-ui-body font-medium" title={name}>
                          <span className="block truncate">{candidateLabel(catalog, c)}</span>
                          <span className="block truncate text-ui-caption font-normal text-(--ui-text-secondary)">
                            {c.harness}
                          </span>
                        </span>
                        <span className="text-ui-caption text-(--ui-text-secondary)">
                          {t("Cost")}
                        </span>
                        <Select
                          hideLabel
                          label={t("Cost of {p0}", { p0: name })}
                          value={c.cost === undefined ? "" : String(c.cost)}
                          options={levelOptions(
                            COST_LEVELS,
                            [t("Low"), t("Medium"), t("High")],
                            c.cost,
                          )}
                          onValueChange={(value) =>
                            updateCandidate(c.id, { cost: value ? Number(value) : undefined })
                          }
                        />
                        <span className="text-ui-caption text-(--ui-text-secondary)">
                          {t("Quality")}
                        </span>
                        <Select
                          hideLabel
                          label={t("Quality of {p0}", { p0: name })}
                          value={c.quality === undefined ? "" : String(c.quality)}
                          options={levelOptions(
                            QUALITY_LEVELS,
                            [t("Basic"), t("Good"), t("Best")],
                            c.quality,
                          )}
                          onValueChange={(value) =>
                            updateCandidate(c.id, { quality: value ? Number(value) : undefined })
                          }
                        />
                      </div>
                      {model?.settings?.length ? (
                        <div className="flex flex-wrap items-center gap-2">
                          {model.settings.map((setting) =>
                            setting.kind === "select" ? (
                              <SearchableSelect
                                hideLabel
                                key={setting.id}
                                label={setting.label}
                                value={c.modelSettings[setting.id] ?? setting.value}
                                options={setting.options.map((o) => ({
                                  value: o.value,
                                  label: o.label,
                                }))}
                                onChange={(value) =>
                                  updateCandidate(c.id, {
                                    modelSettings: { ...c.modelSettings, [setting.id]: value },
                                  })
                                }
                              />
                            ) : (
                              <div
                                key={setting.id}
                                className="flex items-center gap-2 text-ui-caption"
                              >
                                {setting.label}
                                <Toggle
                                  label={setting.label}
                                  on={(c.modelSettings[setting.id] ?? setting.value) === "true"}
                                  onChange={(value) =>
                                    updateCandidate(c.id, {
                                      modelSettings: {
                                        ...c.modelSettings,
                                        [setting.id]: String(value),
                                      },
                                    })
                                  }
                                />
                              </div>
                            ),
                          )}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <p className="text-ui-caption text-(--ui-text-secondary)">
              {t("Ratings are your own judgement; unrated models are treated as unknown.")}
            </p>
          </>
        )}
        {modelError ? <InlineError>{modelError}</InlineError> : null}
      </div>
      {advancedExtra ? (
        <div className="flex flex-col gap-2 pt-1">
          <Button
            variant="ghost"
            motion="none"
            aria-expanded={advanced}
            startIcon={advanced ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
            onClick={() => setAdvanced((value) => !value)}
            className="self-start"
          >
            {t("More options")}
          </Button>
          {advanced ? advancedExtra : null}
        </div>
      ) : null}
    </div>
  );
}
