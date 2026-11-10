import { t, useLocale } from "../../../shared/i18n";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Select } from "../../../shared/ui/Select";
import { Toggle } from "../../settings/public/settingsControls";
import type { CrewCandidate } from "../model/crew";
import type { ProjectCrews } from "../model/crewClient";
import {
  COST_LEVELS,
  QUALITY_LEVELS,
  candidateDetailLabel,
  candidateLabel,
  catalogCandidate,
  catalogModels,
} from "../model/crewRoster";

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
 * A set of automatic candidates: a multi-select of catalog models and, per chosen model,
 * its Cost and Quality ratings plus the model's own options (effort, mode). Shared by the
 * member form and the model pool editor, so both edit candidates the same way.
 */
export function MemberCandidateList({
  catalog,
  candidates,
  onChange,
}: {
  catalog: ProjectCrews["catalog"];
  candidates: CrewCandidate[];
  onChange: (candidates: CrewCandidate[]) => void;
}) {
  useLocale();
  const options = catalogModels(catalog).map((model) => ({
    value: `${model.harness}/${model.id}`,
    label: model.name,
    description: model.harness,
  }));
  const update = (id: string, patch: Partial<CrewCandidate>) =>
    onChange(candidates.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  return (
    <>
      <SearchableSelect
        hideLabel
        label={t("Allowed models")}
        multiple
        options={options}
        placeholder={t("Choose models")}
        value={candidates.map((c) => c.id)}
        onChange={(values) =>
          onChange(
            values.flatMap((value) => {
              const c =
                candidates.find((item) => item.id === value) ?? catalogCandidate(catalog, value);
              return c ? [c] : [];
            }),
          )
        }
      />
      {candidates.length ? (
        <ul
          aria-label={t("Model ratings")}
          className="flex flex-col gap-1 rounded-(--ui-radius-card) border border-(--ui-pane-border) p-1"
        >
          {candidates.map((c) => {
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
                  <span className="text-ui-caption text-(--ui-text-secondary)">{t("Cost")}</span>
                  <Select
                    hideLabel
                    label={t("Cost of {p0}", { p0: name })}
                    value={c.cost === undefined ? "" : String(c.cost)}
                    options={levelOptions(COST_LEVELS, [t("Low"), t("Medium"), t("High")], c.cost)}
                    onValueChange={(value) =>
                      update(c.id, { cost: value ? Number(value) : undefined })
                    }
                  />
                  <span className="text-ui-caption text-(--ui-text-secondary)">{t("Quality")}</span>
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
                      update(c.id, { quality: value ? Number(value) : undefined })
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
                          options={setting.options.map((o) => ({ value: o.value, label: o.label }))}
                          onChange={(value) =>
                            update(c.id, {
                              modelSettings: { ...c.modelSettings, [setting.id]: value },
                            })
                          }
                        />
                      ) : (
                        <div key={setting.id} className="flex items-center gap-2 text-ui-caption">
                          {setting.label}
                          <Toggle
                            label={setting.label}
                            on={(c.modelSettings[setting.id] ?? setting.value) === "true"}
                            onChange={(value) =>
                              update(c.id, {
                                modelSettings: { ...c.modelSettings, [setting.id]: String(value) },
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
    </>
  );
}
