import { useT } from "../../../../shared/i18n";
import {
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENT_MAX_EFFORT_KEY,
  CROSS_SUBAGENTS_KEY,
  SUBAGENT_EFFORT_LEVELS,
  decodeAdvisor,
  subagentEffortCeiling,
} from "../../../../shared/model/host-contracts/delegation";
import { IMAGE_MODELS_KEY } from "../../../../shared/model/host-contracts/image-models";
import { MODEL_ROUTING_DELEGATION_KEYS } from "../../../../shared/model/host-contracts/model-routing";
import { EffortScale } from "../../../../shared/ui/EffortScale";
import { Row } from "../../../../shared/ui/settings";
import { catalogText } from "../../../sessions/public/catalogText";
import { useDelegationSettings } from "../../../sessions/public/modelPickerData";
import {
  AdvisorControl,
  DelegationSelectionControl,
} from "../../../sessions/public/SubagentModeControl";
import type { ModelSetting } from "../../../sessions/public/models";
import type { HarnessId } from "../../../../shared/model/harnessIdentity";

/** Delegation settings in display order, the same as Settings > Models > Defaults: single helpers first. */
const ORDER: readonly string[] = [
  CROSS_ADVISOR_KEY,
  IMAGE_MODELS_KEY,
  CROSS_SUBAGENTS_KEY,
  CROSS_SUBAGENT_MAX_EFFORT_KEY,
];

/**
 * The delegation rows of one layer, with the controls of the Defaults tab: Advisor as switch and
 * model, Image models and Subagents as Automatic, Custom or Off with their models listed, and
 * Subagent max effort as the effort scale with its Automatic switch. Every row shows what applies;
 * an override layer starts from what it inherits and marks the keys it sets with a reset.
 */
export function DelegationLayerRows({
  harness,
  values,
  inherited,
  override,
  disabled,
  keys = ORDER,
  nested = false,
  onSet,
}: {
  /** Provider whose catalog and accounts fill the model lists. */
  harness: HarnessId;
  /** The layer's stored keys. */
  values: Record<string, string>;
  /** What the layer inherits; shown until the layer sets its own value. */
  inherited: Record<string, string>;
  /** The layer overrides another: a stored key gets a reset that returns it to `inherited`. */
  override: boolean;
  disabled: boolean;
  /** The keys this layer offers, in display order; defaults to every delegation key. */
  keys?: readonly string[];
  /** The rows sit under a heading row of their layer and are indented. */
  nested?: boolean;
  /**
   * Set a key; `undefined` clears it. An empty value means Automatic (no advisor for the advisor);
   * an override stores it only where it differs from what is inherited.
   */
  onSet: (key: string, value: string | undefined) => void;
}) {
  const t = useT();
  const effective = { ...inherited, ...values };
  const settings = useDelegationSettings(harness, effective);
  const byId = new Map(settings.map((setting) => [setting.id, setting]));
  const shown = ORDER.filter(
    (key) =>
      keys.includes(key) &&
      byId.has(key) &&
      (MODEL_ROUTING_DELEGATION_KEYS as readonly string[]).includes(key),
  );
  return (
    <>
      {shown.map((key) => {
        const setting = byId.get(key)!;
        const label = catalogText(t, setting.label);
        const set = (next: string) =>
          // An override that returns to an inherited Automatic stores nothing.
          onSet(key, override && next === "" && !inherited[key] ? undefined : next);
        return (
          <Row
            key={key}
            label={label}
            description={setting.description ? catalogText(t, setting.description) : undefined}
            controlWidth={key === CROSS_SUBAGENT_MAX_EFFORT_KEY ? undefined : "wide"}
            dependsOn={nested || undefined}
            modified={override && values[key] !== undefined}
            onReset={() => onSet(key, undefined)}
            resetLabel={t("Use the inherited {p0}", { p0: label })}
            disabled={disabled}
            disabledReason={t("Wait for the current save to finish.")}
          >
            <DelegationControl
              setting={setting}
              label={label}
              value={effective[key]}
              fallback={inherited[key]}
              disabled={disabled}
              onSet={set}
            />
          </Row>
        );
      })}
    </>
  );
}

function DelegationControl({
  setting,
  label,
  value,
  fallback,
  disabled,
  onSet,
}: {
  setting: ModelSetting;
  label: string;
  /** The value that applies: the layer's own, else the inherited one. */
  value: string | undefined;
  /** The inherited value; the advisor starts on it when switched on. */
  fallback: string | undefined;
  disabled: boolean;
  onSet: (value: string) => void;
}) {
  const t = useT();
  if (setting.id === CROSS_SUBAGENTS_KEY || setting.id === IMAGE_MODELS_KEY)
    return (
      <DelegationSelectionControl
        setting={setting}
        label={label}
        value={value || undefined}
        disabled={disabled}
        disabledReason={t("Wait for the current save to finish.")}
        onChange={onSet}
      />
    );
  if (setting.id === CROSS_SUBAGENT_MAX_EFFORT_KEY) {
    const ceiling = subagentEffortCeiling(value);
    return (
      <div className="provider-effort">
        <EffortScale
          label={label}
          showLabel={false}
          value={ceiling}
          disabled={disabled}
          automatic={{
            on: !ceiling,
            onChange: (on) => {
              if (on) onSet("");
            },
          }}
          options={setting.options
            .filter((option) => SUBAGENT_EFFORT_LEVELS.includes(option.value))
            .map((option) => ({ value: option.value, label: catalogText(t, option.label) }))}
          onValueChange={onSet}
        />
      </div>
    );
  }
  return (
    <AdvisorControl
      setting={setting}
      label={label}
      value={value && value !== "null" ? value : ""}
      fallback={fallback && decodeAdvisor(fallback) ? fallback : undefined}
      disabled={disabled}
      onChange={onSet}
    />
  );
}
