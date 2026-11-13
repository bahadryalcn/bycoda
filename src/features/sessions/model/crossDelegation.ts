import { isModelEnabled, type AgentModel, type ModelSetting } from "./models";
import { modelDisplayName } from "./modelDisplayName";
import { HARNESS_TITLE, type HarnessId } from "./session";
import { CLAUDE_SUBAGENT_SETTINGS } from "./claudeSubagents";
import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  supportsProviderAccounts,
} from "../../providers/public/providerAccounts";
import {
  accountModelChoices,
  modelChoiceBaseName,
  type ModelAccountCatalog,
} from "./accountModelChoices";
import {
  AUTOMATIC_SUBAGENTS,
  CROSS_SUBAGENT_MAX_EFFORT_KEY,
  SUBAGENT_EFFORT_LEVELS,
  subagentEffortCeiling,
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENTS_KEY,
  DELEGATION_LIMITS,
  decodeAdvisor,
  decodeSubagents,
  decodeSubagentSelection,
  delegateRefKey,
  encodeAdvisor,
  encodeSubagents,
  type DelegateModelRef,
} from "../../../shared/model/host-contracts/delegation";
import {
  IMAGE_MODEL_IDS,
  IMAGE_MODEL_INFO,
  IMAGE_MODELS_KEY,
  decodeImageModels,
  encodeImageModels,
} from "../../../shared/model/host-contracts/image-models";

/** Mode represented by the persisted subagent selection. */
export function subagentMode(value: string | undefined): "auto" | "custom" | "off" {
  const selection = decodeSubagentSelection(value ?? AUTOMATIC_SUBAGENTS);
  return selection === AUTOMATIC_SUBAGENTS ? "auto" : selection.length ? "custom" : "off";
}

/** Wire value for a non-custom mode. Custom is a picker action. */
export function subagentModeValue(mode: "auto" | "off"): string {
  return mode === "auto" ? AUTOMATIC_SUBAGENTS : "[]";
}

export type DelegationInput = {
  current: AgentModel;
  harnesses: readonly HarnessId[];
  source: { modelsFor(harness: HarnessId): AgentModel[]; accounts?: ModelAccountCatalog };
  accountChoices?: boolean;
  currentAccountId?: string;
  signedOutAccounts?: ReadonlySet<string>;
  signedOutLabel?: string;
  values: Record<string, string>;
  /** Label for a saved model that is no longer offered; the caller translates it. */
  unavailable(name: string): string;
};

const OFF = { value: "", label: "Off" };

/** Option values are the ref's JSON, so a stored advisor matches its option exactly. */
function refValue(ref: DelegateModelRef): string {
  return encodeAdvisor(ref) ?? "";
}

/** An omitted CLI account is the fixed legacy profile, never the current account. */
function choiceKey(ref: DelegateModelRef): string {
  return delegateRefKey(
    supportsProviderAccounts(ref.harness) && !ref.providerAccountId
      ? { ...ref, providerAccountId: DEFAULT_PROVIDER_ACCOUNT_ID }
      : ref,
  );
}

export function isSubagentSetting(setting: ModelSetting): boolean {
  return setting.id === CROSS_SUBAGENTS_KEY;
}

export function isImageModelsSetting(setting: ModelSetting): boolean {
  return setting.id === IMAGE_MODELS_KEY;
}

/** Settings that toggle several options in place: subagents and image models. */
export function isMultiSetting(setting: ModelSetting): boolean {
  return isSubagentSetting(setting) || isImageModelsSetting(setting);
}

export function isDelegationSetting(setting: ModelSetting): boolean {
  return (
    isMultiSetting(setting) ||
    setting.id === CROSS_ADVISOR_KEY ||
    setting.id === CROSS_SUBAGENT_MAX_EFFORT_KEY
  );
}

/**
 * Image models the session's agents may use. Nothing picked is Automatic: every
 * model available on the Host. Codex and Antigravity appear when connected.
 */
export function imageModelsSetting(input: Pick<DelegationInput, "harnesses">): ModelSetting {
  return {
    id: IMAGE_MODELS_KEY,
    label: "Image models",
    kind: "select",
    value: "",
    options: [
      { value: "", label: "Automatic" },
      ...IMAGE_MODEL_IDS.filter((id) => {
        const harness = IMAGE_MODEL_INFO[id].harness;
        return harness !== undefined && input.harnesses.includes(harness);
      }).map((id) => ({ value: id, label: IMAGE_MODEL_INFO[id].name })),
    ],
  };
}

/**
 * The two any-provider rows, appended to every model's menu. Their ids are the
 * reserved keys, so the picker writes them like any other setting.
 */
export function crossDelegationSettings(input: DelegationInput): ModelSetting[] {
  const choices = input.harnesses.flatMap((harness) =>
    accountModelChoices(
      input.source.modelsFor(harness).filter((model) => isModelEnabled(model.id)),
      !!input.accountChoices,
      input.source.accounts,
    ).map((model) => ({
      ref: {
        harness,
        model: model.id,
        ...(model.accountId ? { providerAccountId: model.accountId } : {}),
      } satisfies DelegateModelRef,
      label: `${HARNESS_TITLE[harness]} · ${modelChoiceBaseName(model)}${model.accountLabel ? ` · ${model.accountLabel}` : ""}${model.accountId && input.signedOutAccounts?.has(`${harness}:${model.accountId}`) ? ` · ${input.signedOutLabel ?? "Not signed in"}` : ""}`,
      accountColor: model.accountColor,
    })),
  );
  const known = new Set(choices.map((choice) => choiceKey(choice.ref)));
  const unavailable = (ref: DelegateModelRef) => ({
    value: refValue(ref),
    label: input.unavailable(
      `${HARNESS_TITLE[ref.harness]} · ${modelDisplayName(ref.model, ref.harness)}`,
    ),
  });
  const savedSubagents = decodeSubagents(input.values[CROSS_SUBAGENTS_KEY]);
  const savedAdvisor = decodeAdvisor(input.values[CROSS_ADVISOR_KEY]);
  const legacyRef = (key: string): DelegateModelRef | undefined => {
    if (input.current.harness !== "claude") return undefined;
    const value = input.values[key];
    if (!value || value === "default" || value === "off") return undefined;
    const model = input.source
      .modelsFor("claude")
      .find(
        (candidate) =>
          candidate.id === value ||
          candidate.nativeId === value ||
          candidate.id.replace(/^claude:/, "") === value,
      );
    return {
      harness: "claude",
      model: model?.id ?? value,
      ...(input.currentAccountId ? { providerAccountId: input.currentAccountId } : {}),
    };
  };
  const legacySubagent =
    input.values[CROSS_SUBAGENTS_KEY] === undefined ? legacyRef("subagentModel") : undefined;
  const legacyAdvisor =
    input.values[CROSS_ADVISOR_KEY] === undefined ? legacyRef("advisor") : undefined;
  const legacyOption = (ref: DelegateModelRef) => {
    const option =
      ref.harness === "claude" && ref.model !== "default"
        ? CLAUDE_SUBAGENT_SETTINGS[0].options.find((item) => item.value === ref.model)
        : undefined;
    const account = ref.providerAccountId
      ? accountModelChoices(
          [
            {
              id: ref.model,
              harness: "claude",
              name: option?.label ?? modelDisplayName(ref.model, ref.harness),
            },
          ],
          true,
          input.source.accounts,
        ).find((item) => item.accountId === ref.providerAccountId)
      : undefined;
    if (ref.providerAccountId && !account) return unavailable(ref);
    return option
      ? {
          value: refValue(ref),
          label: `${HARNESS_TITLE[ref.harness]} · ${option.label}${account?.accountLabel ? ` · ${account.accountLabel}` : ""}${ref.providerAccountId && input.signedOutAccounts?.has(`claude:${ref.providerAccountId}`) ? ` · ${input.signedOutLabel ?? "Not signed in"}` : ""}`,
          accountColor: account?.accountColor,
        }
      : unavailable(ref);
  };
  if (legacySubagent) savedSubagents.push(legacySubagent);
  const option = (choice: (typeof choices)[number], saved: DelegateModelRef[]) => ({
    // Keep the saved wire value for native selects; normalization is presentation only.
    value: refValue(saved.find((ref) => choiceKey(ref) === choiceKey(choice.ref)) ?? choice.ref),
    label: choice.label,
    accountColor: choice.accountColor,
  });
  const subagents: ModelSetting = {
    id: CROSS_SUBAGENTS_KEY,
    label: "Subagents",
    kind: "select",
    value: encodeSubagents(legacySubagent ? [legacySubagent] : []) ?? "",
    options: [
      OFF,
      { value: AUTOMATIC_SUBAGENTS, label: "Automatic" },
      ...choices.map((choice) => option(choice, savedSubagents)),
      ...savedSubagents.filter((ref) => !known.has(choiceKey(ref))).map((ref) => legacyOption(ref)),
    ],
  };
  const advisor: ModelSetting = {
    id: CROSS_ADVISOR_KEY,
    label: "Advisor",
    kind: "select",
    value: encodeAdvisor(legacyAdvisor) ?? "",
    options: [
      OFF,
      ...choices.map((choice) =>
        option(choice, (savedAdvisor ?? legacyAdvisor) ? [(savedAdvisor ?? legacyAdvisor)!] : []),
      ),
      ...((savedAdvisor ?? legacyAdvisor) && !known.has(choiceKey((savedAdvisor ?? legacyAdvisor)!))
        ? [legacyOption((savedAdvisor ?? legacyAdvisor)!)]
        : []),
    ],
  };
  return [
    subagents,
    advisor,
    {
      id: CROSS_SUBAGENT_MAX_EFFORT_KEY,
      label: "Subagent max effort",
      description:
        "The highest thinking level a subagent may use, whatever the main model's own level. Automatic sets no limit.",
      kind: "select",
      value: "",
      options: [
        { value: "", label: "Automatic" },
        ...SUBAGENT_EFFORT_LEVELS.map((value) => ({
          value,
          label: value[0].toUpperCase() + value.slice(1),
        })),
      ],
    },
  ];
}

/** Whether an option is on: subagents by membership, the advisor by equality. */
export function delegationOptionSelected(
  setting: ModelSetting,
  values: Record<string, string>,
  value: string,
): boolean {
  if (setting.id === CROSS_SUBAGENT_MAX_EFFORT_KEY)
    return (values[setting.id] ?? setting.value) === value;
  if (!isDelegationSetting(setting)) return (values[setting.id] ?? setting.value) === value;
  if (isImageModelsSetting(setting)) {
    const chosen = decodeImageModels(values[IMAGE_MODELS_KEY] ?? setting.value) ?? [];
    return value ? (chosen as string[]).includes(value) : chosen.length === 0;
  }
  if (isSubagentSetting(setting)) {
    const wire = values[CROSS_SUBAGENTS_KEY] ?? setting.value;
    if (value === AUTOMATIC_SUBAGENTS) return wire === AUTOMATIC_SUBAGENTS;
    if (wire === AUTOMATIC_SUBAGENTS) return false;
    const chosen = decodeSubagents(wire);
    if (!value) return chosen.length === 0;
    const ref = decodeAdvisor(value);
    return !!ref && chosen.some((item) => choiceKey(item) === choiceKey(ref));
  }
  const chosen = decodeAdvisor(values[CROSS_ADVISOR_KEY] ?? setting.value);
  const ref = decodeAdvisor(value);
  return chosen ? !!ref && choiceKey(chosen) === choiceKey(ref) : value === "";
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
  if (isImageModelsSetting(setting)) {
    if (!value) return "";
    const chosen: string[] = decodeImageModels(values[IMAGE_MODELS_KEY] ?? setting.value) ?? [];
    const next = chosen.includes(value) ? chosen.filter((id) => id !== value) : [...chosen, value];
    // Unpicking the last model returns to Automatic rather than turning images off.
    return next.length ? (encodeImageModels(next) ?? "") : "";
  }
  if (!isSubagentSetting(setting)) return value;
  if (value === AUTOMATIC_SUBAGENTS) return value;
  if (!value) return "[]";
  const ref = decodeAdvisor(value);
  if (!ref) return values[CROSS_SUBAGENTS_KEY] ?? "";
  const chosen = decodeSubagents(values[CROSS_SUBAGENTS_KEY] ?? setting.value);
  const key = choiceKey(ref);
  const removing = chosen.some((item) => choiceKey(item) === key);
  const next = removing
    ? chosen.filter((item) => choiceKey(item) !== key)
    : chosen.length >= DELEGATION_LIMITS.subagentModels
      ? chosen
      : [...chosen, ref];
  return encodeSubagents(next) ?? "[]";
}

/** "Off", the one picked option's label, or "<first> +N" for several subagents. */
export function crossDelegationSummary(
  setting: ModelSetting,
  values: Record<string, string>,
): string {
  if (isSubagentSetting(setting)) {
    const wire = values[setting.id] ?? setting.value;
    if (wire === AUTOMATIC_SUBAGENTS) return "Automatic";
    if (decodeSubagents(wire).length === 0) return "Off";
  }
  if (setting.id === CROSS_SUBAGENT_MAX_EFFORT_KEY)
    return (
      setting.options.find(
        (option) => option.value === subagentEffortCeiling(values[setting.id] ?? setting.value),
      )?.label ?? "Automatic"
    );
  const picked = setting.options.filter(
    (option) => option.value && delegationOptionSelected(setting, values, option.value),
  );
  if (picked.length === 0) return setting.options[0]?.label ?? OFF.label;
  return picked.length === 1 ? picked[0].label : `${picked[0].label} +${picked.length - 1}`;
}

/**
 * An option label without its leading "<Provider> · ", for collapsed chips and fields where the
 * provider icon already names it. Pickers keep the full label so same-named models stay apart.
 */
export function delegationShortLabel(setting: ModelSetting, value: string, label: string): string {
  const harness = delegationOptionHarness(setting, value);
  const prefix = harness ? `${HARNESS_TITLE[harness]} · ` : "";
  return prefix && label.startsWith(prefix) ? label.slice(prefix.length) : label;
}

/** The provider of a delegation option, for its icon; undefined for Off and other settings. */
export function delegationOptionHarness(
  setting: ModelSetting,
  value: string,
): HarnessId | undefined {
  return isDelegationSetting(setting) ? decodeAdvisor(value)?.harness : undefined;
}
