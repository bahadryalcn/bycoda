import { isModelEnabled, type AgentModel, type ModelSetting } from "./models";
import { HARNESS_TITLE, type HarnessId } from "./session";
import {
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENTS_KEY,
  DELEGATION_LIMITS,
  decodeAdvisor,
  decodeSubagents,
  delegateRefKey,
  encodeAdvisor,
  encodeSubagents,
  type DelegateModelRef,
} from "../../../shared/model/host-contracts/delegation";

export type DelegationInput = {
  current: AgentModel;
  harnesses: readonly HarnessId[];
  source: { modelsFor(harness: HarnessId): AgentModel[] };
  values: Record<string, string>;
  /** Label for a saved model that is no longer offered; the caller translates it. */
  unavailable(name: string): string;
};

const OFF = { value: "", label: "Off" };

/** Option values are the ref's JSON, so a stored advisor matches its option exactly. */
function refValue(ref: DelegateModelRef): string {
  return encodeAdvisor(ref) ?? "";
}

export function isSubagentSetting(setting: ModelSetting): boolean {
  return setting.id === CROSS_SUBAGENTS_KEY;
}

export function isDelegationSetting(setting: ModelSetting): boolean {
  return isSubagentSetting(setting) || setting.id === CROSS_ADVISOR_KEY;
}

/**
 * The two any-provider rows, appended to every model's menu. Their ids are the
 * reserved keys, so the picker writes them like any other setting.
 */
export function crossDelegationSettings(input: DelegationInput): ModelSetting[] {
  const choices = input.harnesses.flatMap((harness) =>
    input.source
      .modelsFor(harness)
      .filter((model) => isModelEnabled(model.id))
      .map((model) => ({
        ref: { harness, model: model.id } satisfies DelegateModelRef,
        label: `${HARNESS_TITLE[harness]} · ${model.name}`,
      })),
  );
  const known = new Set(choices.map((choice) => delegateRefKey(choice.ref)));
  const unavailable = (ref: DelegateModelRef) => ({
    value: refValue(ref),
    label: input.unavailable(`${HARNESS_TITLE[ref.harness]} · ${ref.model}`),
  });
  const isCurrent = (ref: DelegateModelRef) =>
    ref.harness === input.current.harness && ref.model === input.current.id;

  const savedSubagents = decodeSubagents(input.values[CROSS_SUBAGENTS_KEY]);
  const savedAdvisor = decodeAdvisor(input.values[CROSS_ADVISOR_KEY]);
  const subagents: ModelSetting = {
    id: CROSS_SUBAGENTS_KEY,
    label: "Subagents (any provider)",
    kind: "select",
    value: "",
    options: [
      OFF,
      ...choices.map((choice) => ({ value: refValue(choice.ref), label: choice.label })),
      ...savedSubagents
        .filter((ref) => !known.has(delegateRefKey(ref)))
        .map((ref) => unavailable(ref)),
    ],
  };
  const advisor: ModelSetting = {
    id: CROSS_ADVISOR_KEY,
    label: "Advisor (any provider)",
    kind: "select",
    value: "",
    options: [
      OFF,
      ...choices
        .filter((choice) => !isCurrent(choice.ref))
        .map((choice) => ({ value: refValue(choice.ref), label: choice.label })),
      ...(savedAdvisor && !known.has(delegateRefKey(savedAdvisor))
        ? [unavailable(savedAdvisor)]
        : []),
    ],
  };
  return [subagents, advisor];
}

/** Whether an option is on: subagents by membership, the advisor by equality. */
export function delegationOptionSelected(
  setting: ModelSetting,
  values: Record<string, string>,
  value: string,
): boolean {
  if (!isDelegationSetting(setting)) return (values[setting.id] ?? setting.value) === value;
  if (isSubagentSetting(setting)) {
    const chosen = decodeSubagents(values[CROSS_SUBAGENTS_KEY]);
    if (!value) return chosen.length === 0;
    const ref = decodeAdvisor(value);
    return !!ref && chosen.some((item) => delegateRefKey(item) === delegateRefKey(ref));
  }
  const chosen = decodeAdvisor(values[CROSS_ADVISOR_KEY]);
  return value === (chosen ? refValue(chosen) : "");
}

/**
 * The value after picking `value`. Subagents toggle one model in place (capped at
 * the limit); every other setting takes the picked value unchanged.
 */
export function delegationNextValue(
  setting: ModelSetting,
  values: Record<string, string>,
  value: string,
): string {
  if (!isSubagentSetting(setting)) return value;
  if (!value) return "";
  const ref = decodeAdvisor(value);
  if (!ref) return values[CROSS_SUBAGENTS_KEY] ?? "";
  const chosen = decodeSubagents(values[CROSS_SUBAGENTS_KEY]);
  const key = delegateRefKey(ref);
  const removing = chosen.some((item) => delegateRefKey(item) === key);
  const next = removing
    ? chosen.filter((item) => delegateRefKey(item) !== key)
    : chosen.length >= DELEGATION_LIMITS.subagentModels
      ? chosen
      : [...chosen, ref];
  return encodeSubagents(next) ?? "";
}

/** "Off", the one picked option's label, or "<first> +N" for several subagents. */
export function crossDelegationSummary(
  setting: ModelSetting,
  values: Record<string, string>,
): string {
  const picked = setting.options.filter(
    (option) => option.value && delegationOptionSelected(setting, values, option.value),
  );
  if (picked.length === 0) return setting.options[0]?.label ?? OFF.label;
  return picked.length === 1 ? picked[0].label : `${picked[0].label} +${picked.length - 1}`;
}

/** The provider of a delegation option, for its icon; undefined for Off and other settings. */
export function delegationOptionHarness(
  setting: ModelSetting,
  value: string,
): HarnessId | undefined {
  return isDelegationSetting(setting) ? decodeAdvisor(value)?.harness : undefined;
}
