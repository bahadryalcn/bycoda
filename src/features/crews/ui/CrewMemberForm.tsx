import { useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { NumberField } from "../../../shared/ui/NumberField";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { TagInput } from "../../../shared/ui/TagInput";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { ChevronDown, ChevronRight } from "../../../shared/ui/icons";
import { Toggle } from "../../settings/ui/settingsControls";
import type { HostModelCatalog } from "../../connections/model/protocol";
import type { CrewAgent, CrewCandidate, CrewRole } from "../model/crew";
import { candidateLabel, catalogCandidate, catalogModels } from "../model/crewRoster";
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

/**
 * One member's profile: name, role, instructions and model up front;
 * owner estimates and per-model options behind Advanced.
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
  const estimate = (value: string) => (value === "" ? undefined : Number(value));
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <TextField
          label={t("Name")}
          placeholder={t("e.g. Mobile UI")}
          value={agent.name}
          autoFocus={autoFocus}
          error={nameError}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-medium">{t("Role")}</span>
          <SegmentedControl
            label={t("Role")}
            value={agent.role}
            options={(["coordinator", "specialist", "reviewer", "advisor"] as const).map(
              (role) => ({ value: role, label: roleLabel(role) }),
            )}
            onValueChange={(role) => onChange({ role: role as CrewRole })}
          />
        </div>
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
              ? t("Existing groups: {p0}", {
                  p0: groupSuggestions.slice(0, 8).join(", "),
                })
              : undefined
          }
          onValueChange={(next) => onChange({ groups: next.length ? next : undefined })}
        />
      ) : null}
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">{t("Model")}</span>
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
        )}
        {agent.selection === "automatic" ? (
          <p className="text-xs text-(--ui-text-secondary)">
            {t("The crew's working style picks among these for each assignment.")}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 border-t border-(--ui-tone-neutral-border) pt-2">
        <Button
          variant="ghost"
          motion="none"
          aria-expanded={advanced}
          startIcon={
            advanced ? (
              <ChevronDown className="size-3.5" aria-hidden />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden />
            )
          }
          onClick={() => setAdvanced((value) => !value)}
          className="self-start"
        >
          {t("Advanced")}
        </Button>
        {advanced ? (
          <div className="flex min-w-0 flex-col gap-3">
            <p className="text-xs text-(--ui-text-secondary)">
              {t(
                "Cost and quality are your own estimates for automatic selection. Tool access is never assumed.",
              )}
            </p>
            {agent.candidates.map((c) => {
              const model = catalogModels(catalog).find(
                (m) => m.harness === c.harness && m.id === c.model,
              );
              return (
                <div
                  key={c.id}
                  className="flex min-w-0 flex-col gap-2 rounded-lg border border-(--ui-tone-neutral-border) p-2"
                >
                  <span className="truncate text-sm font-medium">{candidateLabel(catalog, c)}</span>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <NumberField
                      label={t("Estimated cost per assignment")}
                      min={0}
                      value={c.cost ?? ""}
                      onChange={(event) =>
                        updateCandidate(c.id, {
                          cost: estimate(event.target.value),
                        })
                      }
                    />
                    <NumberField
                      label={t("Owner quality estimate")}
                      min={0}
                      max={100}
                      value={c.quality ?? ""}
                      onChange={(event) =>
                        updateCandidate(c.id, {
                          quality: estimate(event.target.value),
                        })
                      }
                    />
                  </div>
                  {agent.selection === "automatic"
                    ? model?.settings?.map((setting) =>
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
                                modelSettings: {
                                  ...c.modelSettings,
                                  [setting.id]: value,
                                },
                              })
                            }
                          />
                        ) : (
                          <label
                            key={setting.id}
                            className="flex items-center justify-between gap-2 text-sm"
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
                      )
                    : null}
                </div>
              );
            })}
            {advancedExtra}
          </div>
        ) : null}
      </div>
    </div>
  );
}
