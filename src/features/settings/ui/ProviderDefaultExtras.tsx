import type { CSSProperties } from "react";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Zap, WandSparkles } from "../../../shared/ui/icons";
import { t } from "../../../shared/i18n";
import {
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENTS_KEY,
} from "../../../shared/model/host-contracts/delegation";
import { IMAGE_MODELS_KEY } from "../../../shared/model/host-contracts/image-models";
import { HARNESS_TITLE, type HarnessId } from "../../../shared/model/harnessIdentity";
import type { ModelSetting } from "../../sessions/public/models";
import {
  isMultiSetting,
  DelegationSubagentsControl,
  DelegationOptionIcon,
} from "../../sessions/public/modelPickerData";
import type { ProviderSessionDefaults } from "../../sessions/public/projectProviders";
import { mergeProviderExtras } from "../../sessions/public/providerSessionDefaults";
import { Row, Select } from "./settingsControls";

/** Label of the "follow the scope above" choice, naming the value it inherits. */
export function inheritedChoiceLabel(inherited: string | undefined, valid: boolean): string {
  return inherited
    ? `${t("Global")} (${inherited}${valid ? "" : ` · ${t("Unavailable")}`})`
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
  return (
    <>
      {extras.map((setting) => {
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
        return (
          <Row
            key={setting.id}
            label={t(setting.label)}
            modified={saved != null || legacy != null}
            onReset={() => {
              const nextExtras = { ...scopeDefaults.extras };
              delete nextExtras[setting.id];
              if (legacyKey) delete nextExtras[legacyKey];
              onSessionDefaultsChange({ ...scopeDefaults, extras: nextExtras });
            }}
            resetLabel={resetLabel}
          >
            {isMultiSetting(setting) ? (
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
              <Select
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
                    icon: <WandSparkles className="icon-sm" />,
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
                    .filter((option) => !delegation || option.value)
                    .map((option) => ({
                      value: option.value,
                      label: t(option.label),
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
