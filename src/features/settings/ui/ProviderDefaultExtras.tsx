import { modelSettingText } from "../model/modelSettingText";
import { EffortScale } from "../../../shared/ui/EffortScale";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Select } from "../../../shared/ui/Select";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Zap, WandSparkles } from "../../../shared/ui/icons";
import { t } from "../../../shared/i18n";
import {
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENT_MAX_EFFORT_KEY,
  CROSS_SUBAGENTS_KEY,
  SUBAGENT_EFFORT_LEVELS,
  decodeAdvisor,
  subagentEffortCeiling,
} from "../../../shared/model/host-contracts/delegation";
import { IMAGE_MODELS_KEY } from "../../../shared/model/host-contracts/image-models";
import { HARNESS_TITLE, type HarnessId } from "../../../shared/model/harnessIdentity";
import type { ModelSetting } from "../../sessions/public/models";
import type { ProviderSessionDefaults } from "../../sessions/public/projectProviders";
import { mergeProviderExtras } from "../../sessions/public/providerSessionDefaults";
import { Row, SettingsFeedback } from "../../../shared/ui/settings";
import {
  AdvisorControl,
  DelegationSelectionControl,
} from "../../sessions/public/SubagentModeControl";

/** Label of the "follow the scope above" choice, naming the value it inherits. */
export function inheritedChoiceLabel(inherited: string | undefined, valid: boolean): string {
  return inherited
    ? `${t("Bycoda defaults")} (${inherited}${valid ? "" : ` · ${t("Unavailable")}`})`
    : t("Automatic");
}

/**
 * The inheriting segment of a segmented default: reads "Default (value)" so it never looks like a
 * duplicate of the segment with that value; the full "Bycoda defaults (…)" text is the tooltip and
 * accessible name, so the control fits the row instead of scrolling.
 */
function inheritedSegment(inherited: string | undefined, valid: boolean) {
  const full = inheritedChoiceLabel(inherited, valid);
  return {
    value: "",
    icon: <WandSparkles className="icon-sm" />,
    label: inherited
      ? `${t("Default")} (${valid ? inherited : `${inherited} · ${t("Unavailable")}`})`
      : full,
    tooltip: inherited ? full : undefined,
    ariaLabel: inherited ? full : undefined,
  };
}

/** Fast and service tier read Fast / Standard whatever the catalog calls them. */
function speedLabel(value: string, label: string): string {
  if (value === "true" || value === "fast") return t("Fast");
  if (value === "false" || value === "default") return t("Standard");
  return modelSettingText(label);
}

/** Choices that fit one segmented row; longer tier lists use a select. */
const SEGMENTED_MAX = 4;

type ExtrasProps = {
  extras: ModelSetting[];
  harness: HarnessId;
  inheritedDefaults?: ProviderSessionDefaults;
  scopeDefaults: ProviderSessionDefaults;
  onSessionDefaultsChange: (next: ProviderSessionDefaults) => void;
  resetLabel: string;
};

export function ProviderDefaultExtras(props: ExtrasProps) {
  const { extras } = props;
  // Auto-compact and its window share one row where both exist; the window alone keeps its own.
  const compact = extras.find((setting) => setting.id === "autoCompact");
  const compactWindow = extras.find((setting) => setting.id === "autoCompactWindow");
  return (
    <>
      {extras
        .filter((setting) => !(compact && setting === compactWindow))
        .map((setting) => (
          <ExtraRow
            key={setting.id}
            {...props}
            setting={setting}
            compactWindow={setting === compact ? compactWindow : undefined}
          />
        ))}
    </>
  );
}

function ExtraRow({
  setting,
  compactWindow,
  harness,
  inheritedDefaults,
  scopeDefaults,
  onSessionDefaultsChange,
  resetLabel,
}: Omit<ExtrasProps, "extras"> & {
  setting: ModelSetting;
  /** Auto-compact's window, edited in the same row. */
  compactWindow?: ModelSetting;
}) {
  const saved = scopeDefaults.extras?.[setting.id];
  const inherited = inheritedDefaults?.extras?.[setting.id];
  const delegation = setting.id === CROSS_SUBAGENTS_KEY || setting.id === CROSS_ADVISOR_KEY;
  const legacyKey =
    harness === "claude" && delegation
      ? setting.id === CROSS_ADVISOR_KEY
        ? "advisor"
        : "subagentModel"
      : undefined;
  const legacy = legacyKey ? scopeDefaults.extras?.[legacyKey] : undefined;
  const effectiveValues = mergeProviderExtras(
    harness,
    inheritedDefaults?.extras,
    scopeDefaults.extras,
  );
  if (delegation && effectiveValues[setting.id] == null && setting.value) {
    effectiveValues[setting.id] = setting.value;
  }
  const inheritedOption = setting.options.find((option) => option.value === inherited);
  const inheritedLabel = inherited === "null" ? "Off" : (inheritedOption?.label ?? inherited);
  const savedIsUnavailable =
    Boolean(saved) &&
    saved !== "null" &&
    !delegation &&
    setting.id !== IMAGE_MODELS_KEY &&
    setting.id !== CROSS_SUBAGENT_MAX_EFFORT_KEY &&
    !setting.options.some((option) => option.value === saved);
  const label = modelSettingText(setting.label);
  const fieldLabel = t("{p0} default {p1}", { p0: HARNESS_TITLE[harness], p1: label });
  /** Store `next` for each key (`undefined` removes it), keeping the other saved extras. */
  const write = (changes: Record<string, string | undefined>) => {
    const nextExtras = { ...scopeDefaults.extras };
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) delete nextExtras[key];
      else nextExtras[key] = value;
    }
    onSessionDefaultsChange({ ...scopeDefaults, extras: nextExtras });
  };
  const choose = (next: string) => write({ [setting.id]: next || undefined });
  const windowSaved = compactWindow ? scopeDefaults.extras?.[compactWindow.id] : undefined;

  let control;
  let feedback;
  if (setting.id === "autoCompact" && !savedIsUnavailable) {
    const effective = effectiveValues.autoCompact ?? setting.value;
    control = (
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        {compactWindow && effective !== "off" ? (
          <CompactWindowSelect
            setting={compactWindow}
            harness={harness}
            saved={windowSaved}
            inherited={inheritedDefaults?.extras?.[compactWindow.id]}
            onChange={(next) => write({ [compactWindow.id]: next || undefined })}
          />
        ) : null}
        <SegmentedControl
          label={label}
          value={saved ?? ""}
          options={[
            inheritedSegment(
              inheritedLabel ? modelSettingText(inheritedLabel) : undefined,
              Boolean(inheritedOption),
            ),
            // Claude default (Claude Code's own /config choice) is what Automatic already does;
            // it stays a segment only while it is the saved value, so that value remains visible.
            ...setting.options
              .filter(
                (option) =>
                  option.value !== "" && (option.value !== "default" || saved === "default"),
              )
              .map((option) => ({
                value: option.value,
                label:
                  option.value === "default" ? t("Claude default") : modelSettingText(option.label),
              })),
          ]}
          onValueChange={choose}
        />
      </div>
    );
  } else if (setting.id === "autoCompactWindow") {
    control = (
      <CompactWindowSelect
        setting={setting}
        harness={harness}
        saved={saved}
        inherited={inherited}
        onChange={choose}
      />
    );
  } else if (setting.id === CROSS_SUBAGENT_MAX_EFFORT_KEY) {
    const ceiling = subagentEffortCeiling(effectiveValues[setting.id]);
    control = (
      <div className="provider-effort">
        <EffortScale
          label={label}
          showLabel={false}
          value={ceiling}
          automatic={{
            on: !ceiling,
            // Stored explicitly only over an inherited limit, so a project keeps no limit even
            // where its defaults set one; otherwise Automatic is simply nothing saved.
            onChange: (on) => {
              if (on) write({ [setting.id]: subagentEffortCeiling(inherited) ? "" : undefined });
            },
          }}
          options={setting.options
            .filter((option) => SUBAGENT_EFFORT_LEVELS.includes(option.value))
            .map((option) => ({ value: option.value, label: modelSettingText(option.label) }))}
          onValueChange={(next) => write({ [setting.id]: next || undefined })}
        />
      </div>
    );
  } else if (setting.id === CROSS_SUBAGENTS_KEY || setting.id === IMAGE_MODELS_KEY) {
    control = (
      <DelegationSelectionControl
        setting={setting}
        label={label}
        value={effectiveValues[setting.id]}
        onChange={(next) =>
          // Image models' Automatic is stored by inheriting; subagents replace the legacy model.
          write({
            [setting.id]: next || undefined,
            ...(legacyKey ? { [legacyKey]: undefined } : {}),
          })
        }
      />
    );
  } else if (setting.id === CROSS_ADVISOR_KEY) {
    const value =
      saved === "null"
        ? ""
        : (saved ?? (legacy != null ? setting.value : effectiveValues[setting.id]));
    // A truncated "Unavailable: …" in the field is easy to miss; say what it means and what to do.
    const chosen = setting.options.find((option) => option.value === value);
    if (chosen && "unavailable" in chosen && chosen.unavailable === true)
      feedback = (
        <SettingsFeedback state="warning">
          {t(
            "This advisor model is unavailable, so the advisor is not used. Choose another model or turn the advisor off.",
          )}
        </SettingsFeedback>
      );
    control = (
      <AdvisorControl
        setting={setting}
        label={label}
        value={value}
        fallback={inherited && decodeAdvisor(inherited) ? inherited : undefined}
        onChange={(next) =>
          write({ [setting.id]: next || "null", ...(legacyKey ? { [legacyKey]: undefined } : {}) })
        }
      />
    );
  } else if ((setting.id === "fast" || setting.id === "serviceTier") && !savedIsUnavailable) {
    const inheritedChoice = inheritedSegment(
      inheritedOption
        ? speedLabel(inheritedOption.value, inheritedOption.label)
        : inheritedLabel
          ? modelSettingText(inheritedLabel)
          : undefined,
      Boolean(inheritedOption),
    );
    // Standard leads on every provider; Claude's Fast toggle lists On before Off.
    const standard = (value: string) => value === "false" || value === "default";
    const tiers = setting.options
      .filter((option) => option.value !== "")
      .sort((a, b) => Number(standard(b.value)) - Number(standard(a.value)))
      .map((option) => ({
        value: option.value,
        label: speedLabel(option.value, option.label),
        icon: ["true", "fast", "priority"].includes(option.value) ? (
          <Zap className="icon-sm" />
        ) : undefined,
      }));
    control =
      tiers.length + 1 <= SEGMENTED_MAX ? (
        <SegmentedControl
          label={label}
          value={saved ?? ""}
          options={[inheritedChoice, ...tiers]}
          onValueChange={choose}
        />
      ) : (
        <Select
          hideLabel
          label={fieldLabel}
          value={saved ?? ""}
          options={[
            { value: "", label: inheritedChoice.ariaLabel ?? inheritedChoice.label },
            ...tiers,
          ]}
          onValueChange={choose}
        />
      );
  } else {
    control = (
      <SearchableSelect
        hideLabel
        label={fieldLabel}
        value={saved ?? ""}
        options={[
          {
            value: "",
            label: inheritedChoiceLabel(
              inheritedLabel ? modelSettingText(inheritedLabel) : undefined,
              Boolean(inheritedOption),
            ),
          },
          ...(savedIsUnavailable
            ? [{ value: saved!, label: `${saved} (${t("Unavailable")})` }]
            : []),
          ...setting.options
            .filter((option) => option.value !== "")
            .map((option) => ({
              value: option.value,
              label: modelSettingText(option.label),
              disabled: "disabled" in option && option.disabled === true,
            })),
        ]}
        onChange={choose}
      />
    );
  }

  return (
    <Row
      label={label}
      description={setting.description ? modelSettingText(setting.description) : undefined}
      modified={saved != null || legacy != null || windowSaved != null}
      onReset={() =>
        write({
          [setting.id]: undefined,
          ...(legacyKey ? { [legacyKey]: undefined } : {}),
          ...(compactWindow ? { [compactWindow.id]: undefined } : {}),
        })
      }
      resetLabel={resetLabel}
      feedback={feedback}
      controlWidth={
        delegation ||
        setting.id === IMAGE_MODELS_KEY ||
        setting.id === "autoCompact" ||
        setting.id === "fast" ||
        setting.id === "serviceTier"
          ? "wide"
          : undefined
      }
    >
      {control}
    </Row>
  );
}

/**
 * The auto-compact window. Automatic leaves the window to the scope above (or Claude Code's own);
 * a saved "default" stays listed as Claude default so the saved value remains visible.
 */
function CompactWindowSelect({
  setting,
  harness,
  saved,
  inherited,
  onChange,
}: {
  setting: ModelSetting;
  harness: HarnessId;
  saved: string | undefined;
  inherited: string | undefined;
  onChange: (next: string) => void;
}) {
  const inheritedOption = setting.options.find((option) => option.value === inherited);
  const windowLabel = (option: { value: string; label: string }) =>
    option.value === "default"
      ? t("Claude default")
      : t("{p0} tokens", { p0: modelSettingText(option.label) });
  const unavailable =
    saved != null && saved !== "" && !setting.options.some((option) => option.value === saved);
  return (
    <Select
      hideLabel
      label={t("{p0} default {p1}", {
        p0: HARNESS_TITLE[harness],
        p1: modelSettingText(setting.label),
      })}
      value={saved ?? ""}
      options={[
        {
          value: "",
          label:
            inheritedOption && inheritedOption.value !== "default"
              ? inheritedChoiceLabel(windowLabel(inheritedOption), true)
              : t("Default window"),
        },
        ...(unavailable ? [{ value: saved!, label: `${saved} (${t("Unavailable")})` }] : []),
        ...setting.options
          .filter(
            (option) => option.value !== "" && (option.value !== "default" || saved === "default"),
          )
          .map((option) => ({ value: option.value, label: windowLabel(option) })),
      ]}
      onValueChange={onChange}
    />
  );
}
