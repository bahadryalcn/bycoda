import { useT } from "../../../../shared/i18n";
import {
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENT_MAX_EFFORT_KEY,
  CROSS_SUBAGENTS_KEY,
  SUBAGENT_EFFORT_LEVELS,
  subagentEffortCeiling,
} from "../../../../shared/model/host-contracts/delegation";
import { IMAGE_MODELS_KEY } from "../../../../shared/model/host-contracts/image-models";
import { MODEL_ROUTING_DELEGATION_KEYS } from "../../../../shared/model/host-contracts/model-routing";
import { EffortScale } from "../../../../shared/ui/EffortScale";
import { SearchableSelect } from "../../../../shared/ui/SearchableSelect";
import { Row } from "../../../../shared/ui/settings";
import {
  DelegationOptionIcon,
  DelegationSubagentsControl,
  SubagentEffortSwitch,
  delegationSelectChoice,
  useDelegationSettings,
} from "../../../sessions/public/modelPickerData";
import { SubagentSelectionControl } from "../../../sessions/public/SubagentModeControl";
import type { ModelSetting } from "../../../sessions/public/models";
import type { HarnessId } from "../../../../shared/model/harnessIdentity";
import { DelegationKeyMenu } from "./DelegationKeyMenu";

/** Settings the layer's controls and Add menu share, in display order. */
const ORDER: readonly string[] = [
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENTS_KEY,
  CROSS_SUBAGENT_MAX_EFFORT_KEY,
  IMAGE_MODELS_KEY,
];

/** The translated text of a delegation setting or option label that the catalog supplies in English. */
function delegationText(translate: ReturnType<typeof useT>, label: string): string {
  switch (label) {
    case "Subagents":
      return translate("Subagents");
    case "Advisor":
      return translate("Advisor");
    case "Image models":
      return translate("Image models");
    case "Subagent max effort":
      return translate("Subagent max effort");
    case "Automatic":
      return translate("Automatic");
    case "Off":
      return translate("Off");
    case "Low":
      return translate("Low");
    case "Medium":
      return translate("Medium");
    case "High":
      return translate("High");
    case "Xhigh":
      return translate("Xhigh");
    case "Max":
      return translate("Max");
    case "Ultra":
      return translate("Ultra");
    default:
      return label;
  }
}

/**
 * The delegation rows of one layer. The global layer always shows every key; an override shows
 * only the keys it sets, each with a Remove, and an Add menu for the rest.
 */
export function DelegationLayerRows({
  harness,
  values,
  inherited,
  override,
  disabled,
  keys = ORDER,
  onSet,
}: {
  /** Provider whose catalog and accounts fill the model lists. */
  harness: HarnessId;
  /** The layer's stored keys. */
  values: Record<string, string>;
  /** What the layer inherits; seeds a newly added override key. */
  inherited: Record<string, string>;
  override: boolean;
  disabled: boolean;
  /** The keys this layer offers, in display order; defaults to every delegation key. */
  keys?: readonly string[];
  /** Set a key; `undefined` or an empty value clears it (an override's Off stays stored). */
  onSet: (key: string, value: string | undefined) => void;
}) {
  const t = useT();
  const settings = useDelegationSettings(harness, values);
  const byId = new Map(settings.map((setting) => [setting.id, setting]));
  const shown = ORDER.filter((key) => keys.includes(key)).filter(
    (key) =>
      byId.has(key) &&
      MODEL_ROUTING_DELEGATION_KEYS.includes(key as never) &&
      (!override || values[key] !== undefined),
  );
  const addable = override
    ? ORDER.filter((key) => keys.includes(key)).flatMap((key) => {
        const setting = byId.get(key);
        return setting && values[key] === undefined && seed(setting, inherited) !== undefined
          ? [{ key, label: delegationText(t, setting.label), value: seed(setting, inherited)! }]
          : [];
      })
    : [];
  return (
    <>
      {shown.map((key) => {
        const setting = byId.get(key)!;
        const label = delegationText(t, setting.label);
        return (
          <Row
            key={key}
            label={label}
            stacked={key === CROSS_SUBAGENTS_KEY}
            modified={override}
            onReset={() => onSet(key, undefined)}
            resetLabel={t("Remove {p0} override", { p0: label })}
            disabled={disabled}
            disabledReason={t("Wait for the current save to finish.")}
          >
            <DelegationControl
              setting={setting}
              label={label}
              value={values[key]}
              override={override}
              disabled={disabled}
              onSet={(next) => onSet(key, next)}
            />
          </Row>
        );
      })}
      {override && addable.length > 0 ? (
        <DelegationKeyMenu
          choices={addable}
          disabled={disabled}
          onPick={(choice) => onSet(choice.key, choice.value)}
        />
      ) : null}
    </>
  );
}

/** First value for a newly added override key: the inherited one, else a representative choice. */
function seed(setting: ModelSetting, inherited: Record<string, string>): string | undefined {
  if (inherited[setting.id]) return inherited[setting.id];
  if (setting.id === CROSS_SUBAGENTS_KEY) return "auto";
  if (setting.id === CROSS_ADVISOR_KEY) return "null";
  if (setting.id === CROSS_SUBAGENT_MAX_EFFORT_KEY)
    return setting.options.find((option) => option.value === "medium")?.value ?? undefined;
  return setting.options.find((option) => option.value)?.value;
}

function DelegationControl({
  setting,
  label,
  value,
  override,
  disabled,
  onSet,
}: {
  setting: ModelSetting;
  label: string;
  value: string | undefined;
  override: boolean;
  disabled: boolean;
  onSet: (value: string) => void;
}) {
  const t = useT();
  const values = value === undefined ? {} : { [setting.id]: value };
  if (setting.id === CROSS_SUBAGENTS_KEY)
    return <SubagentSelectionControl setting={setting} value={value} onChange={onSet} compact />;
  if (setting.id === IMAGE_MODELS_KEY)
    return (
      <DelegationSubagentsControl
        label={label}
        setting={setting}
        values={values}
        disabled={disabled}
        appearance="field"
        onChange={onSet}
      />
    );
  if (setting.id === CROSS_SUBAGENT_MAX_EFFORT_KEY) {
    const ceiling = subagentEffortCeiling(value);
    const levels = setting.options.map((option) => option.value).filter(Boolean);
    return (
      <div className="provider-effort provider-effort-ceiling">
        {override ? null : (
          <SubagentEffortSwitch
            value={value ?? ""}
            levels={levels}
            disabled={disabled}
            onChange={onSet}
          />
        )}
        <EffortScale
          label={label}
          showLabel={false}
          showValue={Boolean(ceiling)}
          value={ceiling}
          disabled={disabled}
          options={setting.options
            .filter((option) => SUBAGENT_EFFORT_LEVELS.includes(option.value))
            .map((option) => ({ value: option.value, label: delegationText(t, option.label) }))}
          onValueChange={onSet}
        />
      </div>
    );
  }
  return (
    <SearchableSelect
      hideLabel
      label={label}
      triggerProps={{ "aria-label": label }}
      value={value && value !== "null" ? value : ""}
      disabled={disabled}
      onChange={onSet}
      options={setting.options.map((option) => ({
        value: option.value,
        ...delegationSelectChoice(setting, option, t),
        icon: <DelegationOptionIcon setting={setting} value={option.value} />,
      }))}
    />
  );
}
