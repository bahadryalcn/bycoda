import { useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Select } from "../../../shared/ui/Select";
import { TagInput } from "../../../shared/ui/TagInput";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { ChevronDown, ChevronRight } from "../../../shared/ui/icons";
import { Toggle } from "../../settings/ui/settingsControls";
import type { HostModelCatalog } from "../../connections/model/protocol";
import type { CrewAgent, CrewCandidate, CrewRole } from "../model/crew";
import {
  COST_LEVELS,
  QUALITY_LEVELS,
  candidateLabel,
  catalogCandidate,
  catalogModels,
} from "../model/crewRoster";
import { MemberModelPicker } from "./MemberModelPicker";

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
 * One member: a role name of the owner's choosing, its responsibility in the crew,
 * instructions and model. Ratings only appear where automatic selection uses them.
 */
export function CrewMemberForm({
  cwd,
  catalog,
  agent,
  onChange,
  groups,
  groupSuggestions = [],
  nameError,
  advancedExtra,
  autoFocus,
}: {
  cwd: string;
  catalog: HostModelCatalog;
  agent: CrewAgent;
  onChange: (patch: Partial<CrewAgent>) => void;
  /** Shown when the host keeps specialty groups. */
  groups?: boolean;
  groupSuggestions?: string[];
  nameError?: string;
  advancedExtra?: ReactNode;
  autoFocus?: boolean;
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
  const suggestions = agent.name.trim()
    ? []
    : roleSuggestions(agent.role).filter((name) => name !== agent.name);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <TextField
          label={t("Role")}
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
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-ui-body font-medium">{t("Responsibility in the crew")}</span>
        <SegmentedControl
          label={t("Responsibility in the crew")}
          value={agent.role}
          options={(["coordinator", "specialist", "reviewer", "advisor"] as const).map((role) => ({
            value: role,
            label: roleLabel(role),
          }))}
          onValueChange={(role) => onChange({ role: role as CrewRole })}
        />
        <p className="text-ui-caption text-(--ui-text-secondary)">
          {responsibilityHint(agent.role)}
        </p>
      </div>
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
        {agent.selection === "fixed" ? (
          <MemberModelPicker
            cwd={cwd}
            value={agent.candidates[0]}
            onChange={(next) =>
              onChange({
                candidates: [next, ...agent.candidates.slice(1).filter((c) => c.id !== next.id)],
              })
            }
          />
        ) : (
          <>
            <p className="text-ui-caption text-(--ui-text-secondary)">
              {t(
                "For each assignment the crew picks one of these models, using your ratings and the crew's working style.",
              )}
            </p>
            <SearchableSelect
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
                className="flex flex-col divide-y divide-(--ui-tone-neutral-border) rounded-lg border border-(--ui-tone-neutral-border)"
              >
                {agent.candidates.map((c) => {
                  const model = catalogModels(catalog).find(
                    (m) => m.harness === c.harness && m.id === c.model,
                  );
                  const name = candidateLabel(catalog, c);
                  return (
                    <li key={c.id} className="flex min-w-0 flex-col gap-2 px-3 py-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-ui-body font-medium">
                          {name}
                        </span>
                        <span className="text-ui-caption text-(--ui-text-secondary)">
                          {t("Cost")}
                        </span>
                        <Select
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
                              <label
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
                              </label>
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
      </div>
      {advancedExtra ? (
        <div className="flex flex-col gap-2 border-t border-(--ui-tone-neutral-border) pt-2">
          <Button
            variant="ghost"
            motion="none"
            aria-expanded={advanced}
            startIcon={
              advanced ? (
                <ChevronDown className="icon-sm" aria-hidden />
              ) : (
                <ChevronRight className="icon-sm" aria-hidden />
              )
            }
            onClick={() => setAdvanced((value) => !value)}
            className="self-start"
          >
            {t("Advanced")}
          </Button>
          {advanced ? advancedExtra : null}
        </div>
      ) : null}
    </div>
  );
}
