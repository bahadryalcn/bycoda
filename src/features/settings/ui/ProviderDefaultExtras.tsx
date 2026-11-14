import { EffortScale } from "../../../shared/ui/EffortScale";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Select } from "../../../shared/ui/Select";
import { delegationSelectChoice } from "../../sessions/public/modelPickerData";
import type { CSSProperties } from "react";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Zap, WandSparkles } from "../../../shared/ui/icons";
import { t } from "../../../shared/i18n";
import {
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENT_MAX_EFFORT_KEY,
  CROSS_SUBAGENTS_KEY,
  SUBAGENT_EFFORT_LEVELS,
  subagentEffortCeiling,
} from "../../../shared/model/host-contracts/delegation";
import { IMAGE_MODELS_KEY } from "../../../shared/model/host-contracts/image-models";
import { HARNESS_TITLE, type HarnessId } from "../../../shared/model/harnessIdentity";
import type { ModelSetting } from "../../sessions/public/models";
import {
  isMultiSetting,
  DelegationSubagentsControl,
  DelegationOptionIcon,
  SubagentEffortSwitch,
} from "../../sessions/public/modelPickerData";
import type { ProviderSessionDefaults } from "../../sessions/public/projectProviders";
import { mergeProviderExtras } from "../../sessions/public/providerSessionDefaults";
import { Row } from "./settingsControls";
import { ProviderDefaultSubagents } from "./ProviderDefaultSubagents";

/** Label of the "follow the scope above" choice, naming the value it inherits. */
export function inheritedChoiceLabel(inherited: string | undefined, valid: boolean): string {
  return inherited
    ? `${t("Bycoda defaults")} (${inherited}${valid ? "" : ` · ${t("Unavailable")}`})`
    : t("Automatic");
}

export function ProviderDefaultExtras({
  extras,
  harness,
  inheritedDefaults,
  scopeDefaults,
  onSessionDefaultsChange,
  projectScope,
  resetLabel,
}: {
  extras: ModelSetting[];
  harness: HarnessId;
  inheritedDefaults?: ProviderSessionDefaults;
  scopeDefaults: ProviderSessionDefaults;
  onSessionDefaultsChange: (next: ProviderSessionDefaults) => void;
  projectScope: boolean;
  resetLabel: string;
}) {
  const threshold = extras.find((setting) => setting.id === "autoCompactWindow");
  const orderedExtras =
    threshold && extras.some((setting) => setting.id === "autoCompact")
      ? extras
          .filter((setting) => setting !== threshold)
          .flatMap((setting) => (setting.id === "autoCompact" ? [setting, threshold] : [setting]))
      : extras;
  return (
    <>
      {orderedExtras.map((setting) => {
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
          !setting.options.some((option) => option.value === saved);
        const compact = setting.id === "autoCompact" || setting.id === "autoCompactWindow";
        const compactDisabled =
          setting.id === "autoCompactWindow" && effectiveValues.autoCompact === "off";
        const updateCompact = (next: string) => {
          const extras = { ...scopeDefaults.extras };
          if (next) extras[setting.id] = next;
          else delete extras[setting.id];
          onSessionDefaultsChange({ ...scopeDefaults, extras });
        };
        const compactOptions = compact
          ? [
              {
                value: "",
                label: inheritedChoiceLabel(
                  inheritedLabel ? t(inheritedLabel) : undefined,
                  Boolean(inheritedOption),
                ),
              },
              ...(savedIsUnavailable
                ? [{ value: saved!, label: `${saved} (${t("Unavailable")})` }]
                : []),
              ...setting.options.map((option) => ({ value: option.value, label: t(option.label) })),
            ]
          : [];
        return (
          <Row
            key={setting.id}
            label={t(setting.label)}
            description={setting.description ? t(setting.description) : undefined}
            modified={saved != null || legacy != null}
            onReset={() => {
              const nextExtras = { ...scopeDefaults.extras };
              delete nextExtras[setting.id];
              if (legacyKey) delete nextExtras[legacyKey];
              onSessionDefaultsChange({ ...scopeDefaults, extras: nextExtras });
            }}
            resetLabel={resetLabel}
          >
            {compact ? (
              setting.id === "autoCompact" && !savedIsUnavailable ? (
                <SegmentedControl
                  label={t(setting.label)}
                  value={saved ?? ""}
                  options={compactOptions}
                  onValueChange={updateCompact}
                />
              ) : (
                <Select
                  hideLabel
                  label={t("{p0} default {p1}", {
                    p0: HARNESS_TITLE[harness],
                    p1: t(setting.label),
                  })}
                  value={saved ?? ""}
                  options={compactOptions}
                  disabled={compactDisabled}
                  onValueChange={updateCompact}
                />
              )
            ) : setting.id === CROSS_SUBAGENT_MAX_EFFORT_KEY ? (
              <div className="provider-effort provider-effort-ceiling">
                <SubagentEffortSwitch
                  value={effectiveValues[setting.id] ?? ""}
                  onChange={(next) =>
                    onSessionDefaultsChange({
                      ...scopeDefaults,
                      extras: { ...scopeDefaults.extras, [setting.id]: next },
                    })
                  }
                />
                <EffortScale
                  label={t(setting.label)}
                  showLabel={false}
                  value={subagentEffortCeiling(effectiveValues[setting.id]) || ""}
                  disabled={!subagentEffortCeiling(effectiveValues[setting.id])}
                  options={setting.options
                    .filter((option) => SUBAGENT_EFFORT_LEVELS.includes(option.value))
                    .map((option) => ({
                      value: option.value,
                      label: t(option.label),
                    }))}
                  onValueChange={(next) => {
                    const nextExtras = { ...scopeDefaults.extras };
                    if (next) nextExtras[setting.id] = next;
                    else delete nextExtras[setting.id];
                    onSessionDefaultsChange({ ...scopeDefaults, extras: nextExtras });
                  }}
                />
              </div>
            ) : setting.id === CROSS_SUBAGENTS_KEY ? (
              <ProviderDefaultSubagents
                setting={setting}
                value={effectiveValues[setting.id]}
                onChange={(next) => {
                  const extras = { ...scopeDefaults.extras, [setting.id]: next };
                  delete extras.subagentModel;
                  onSessionDefaultsChange({ ...scopeDefaults, extras });
                }}
              />
            ) : isMultiSetting(setting) ? (
              <DelegationSubagentsControl
                label={t("{p0} default {p1}", {
                  p0: HARNESS_TITLE[harness],
                  p1: t(setting.label),
                })}
                setting={setting}
                values={effectiveValues}
                disabled={false}
                appearance="field"
                onChange={(next) => {
                  const extras = { ...scopeDefaults.extras, [setting.id]: next || "[]" };
                  // Image models: nothing picked is Automatic, stored by inheriting.
                  if (!next && setting.id === IMAGE_MODELS_KEY) delete extras[setting.id];
                  delete extras.subagentModel;
                  onSessionDefaultsChange({ ...scopeDefaults, extras });
                }}
              />
            ) : (setting.id === "fast" || setting.id === "serviceTier") && !savedIsUnavailable ? (
              <div
                style={
                  {
                    "--ui-surface-selected":
                      saved === "true" || saved === "fast"
                        ? "var(--ui-tone-accent-subtle)"
                        : undefined,
                  } as CSSProperties
                }
              >
                <SegmentedControl
                  label={t(setting.label)}
                  value={saved ?? ""}
                  options={[
                    {
                      value: "",
                      icon: <WandSparkles className="icon-sm" />,
                      label: inheritedChoiceLabel(
                        inheritedLabel ? t(inheritedLabel) : undefined,
                        Boolean(inheritedOption),
                      ),
                    },
                    ...setting.options.map((option) => ({
                      value: option.value,
                      label:
                        option.value === "true" || option.value === "fast"
                          ? t("Fast")
                          : option.value === "false" || option.value === "default"
                            ? t("Standard")
                            : t(option.label),
                      icon:
                        option.value === "true" || option.value === "fast" ? (
                          <Zap className="icon-sm" tone="accent" fill="currentColor" />
                        ) : undefined,
                    })),
                  ]}
                  onValueChange={(next) => {
                    const extras = { ...scopeDefaults.extras };
                    if (next) extras[setting.id] = next;
                    else delete extras[setting.id];
                    onSessionDefaultsChange({ ...scopeDefaults, extras });
                  }}
                />
              </div>
            ) : (
              <SearchableSelect
                hideLabel
                label={t("{p0} default {p1}", {
                  p0: HARNESS_TITLE[harness],
                  p1: t(setting.label),
                })}
                value={
                  delegation
                    ? saved === "null"
                      ? "__off"
                      : (saved ??
                        (legacy != null
                          ? setting.value || "__off"
                          : projectScope
                            ? ""
                            : setting.value))
                    : (saved ?? "")
                }
                options={[
                  {
                    value: "",
                    label: inheritedChoiceLabel(
                      inheritedLabel ? t(inheritedLabel) : undefined,
                      Boolean(inheritedOption) || inherited === "null",
                    ),
                  },
                  ...(delegation ? [{ value: "__off", label: t("Off") }] : []),
                  ...(savedIsUnavailable
                    ? [{ value: saved!, label: `${saved} (${t("Unavailable")})` }]
                    : []),
                  ...setting.options
                    .filter((option) => option.value !== "")
                    .map((option) => ({
                      value: option.value,
                      ...delegationSelectChoice(setting, option, t),
                      disabled: "disabled" in option && option.disabled === true,
                      icon: delegation ? (
                        <DelegationOptionIcon setting={setting} value={option.value} />
                      ) : undefined,
                    })),
                ]}
                onChange={(next) => {
                  const nextExtras = { ...scopeDefaults.extras };
                  if (legacyKey) delete nextExtras[legacyKey];
                  if (next) nextExtras[setting.id] = next === "__off" ? "null" : next;
                  else delete nextExtras[setting.id];
                  onSessionDefaultsChange({
                    ...scopeDefaults,
                    extras: nextExtras,
                  });
                }}
              />
            )}
          </Row>
        );
      })}
    </>
  );
}
