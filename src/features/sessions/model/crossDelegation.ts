import { isModelEnabled, modelEffortSetting, type AgentModel, type ModelSetting } from "./models";
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
  source: {
    modelsFor(harness: HarnessId): AgentModel[];
    accounts?: ModelAccountCatalog;
    accountsKnown?(harness: HarnessId): boolean;
  };
  accountChoices?: boolean;
  currentAccountId?: string;
  signedOutAccounts?: ReadonlySet<string>;
  signedOutLabel?: string;
  /** Account part of a saved selection whose Host account list has not arrived. */
  savedAccountLabel?: string;
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

/** Account and model display details computed by the picker, outside the Host DTO. */
export type DelegationOption = ModelSetting["options"][number] & {
  modelLabel?: string;
  accountLabel?: string;
  accountColor?: string;
  accountNumber?: number;
  detail?: string;
};

type DelegationChoice = Omit<DelegationOption, "value"> & {
  ref: DelegateModelRef;
  /** Provider and model, without the account. */
  name: string;
};

/**
 * In a Claude conversation a Claude advisor is Claude Code's built-in advisor
 * tool, which runs on the conversation's own account (`nativeAdvisor`): one row
 * per Claude model, not one per account. It keeps the saved ref, else the
 * conversation's account. Other providers' advisors stay per account.
 */
function builtInAdvisorChoices(
  choices: readonly DelegationChoice[],
  input: DelegationInput,
  saved: DelegateModelRef | undefined,
): DelegationChoice[] {
  if (input.current.harness !== "claude") return [...choices];
  const rank = (choice: DelegationChoice) =>
    saved?.harness === "claude" && saved.model === choice.ref.model
      ? choiceKey(saved) === choiceKey(choice.ref)
        ? 0
        : 1
      : choice.ref.providerAccountId === input.currentAccountId
        ? 2
        : 3;
  const best = new Map<string, DelegationChoice>();
  for (const choice of choices) {
    if (choice.ref.harness !== "claude") continue;
    const kept = best.get(choice.ref.model);
    if (!kept || rank(choice) < rank(kept)) best.set(choice.ref.model, choice);
  }
  return choices.flatMap((choice) => {
    if (choice.ref.harness !== "claude") return [choice];
    const kept = best.get(choice.ref.model);
    if (kept !== choice) return [];
    // A saved ref on another account still selects this row.
    const ref =
      saved?.harness === "claude" && saved.model === choice.ref.model ? saved : choice.ref;
    const active = choices.find(
      (candidate) =>
        candidate.ref.harness === "claude" &&
        (candidate.ref.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID) ===
          (input.currentAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID),
    );
    return [
      {
        ...choice,
        ref,
        label: choice.name,
        accountColor: active?.accountColor,
        accountLabel: active?.accountLabel,
        accountNumber: active?.accountNumber,
      },
    ];
  });
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
      modelLabel: modelChoiceBaseName(model),
      accountColor: model.accountColor,
      accountNumber: model.accountNumber,
      accountLabel: model.accountNumber ? model.accountLabel : undefined,
      detail:
        model.accountId && input.signedOutAccounts?.has(`${harness}:${model.accountId}`)
          ? (input.signedOutLabel ?? "Not signed in")
          : undefined,
      name: `${HARNESS_TITLE[harness]} · ${modelChoiceBaseName(model)}`,
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
    // An unknown list never condemns a saved ref; the owning Host validates on send.
    if (input.source.accountsKnown?.(ref.harness) === false)
      return {
        value: refValue(ref),
        label: `${HARNESS_TITLE[ref.harness]} · ${option?.label ?? modelDisplayName(ref.model, ref.harness)} · ${input.savedAccountLabel ?? "Saved account"}`,
      };
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
          accountNumber: account?.accountNumber,
          accountLabel: account?.accountNumber ? account.accountLabel : undefined,
          modelLabel: option.label,
        }
      : unavailable(ref);
  };
  if (legacySubagent) savedSubagents.push(legacySubagent);
  const option = (choice: DelegationChoice, saved: DelegateModelRef[]): DelegationOption => ({
    // Keep the saved wire value for native selects; normalization is presentation only.
    value: refValue(saved.find((ref) => choiceKey(ref) === choiceKey(choice.ref)) ?? choice.ref),
    label: choice.label,
    accountColor: choice.accountColor,
    accountNumber: choice.accountNumber,
    accountLabel: choice.accountLabel,
    modelLabel: choice.modelLabel,
    detail: choice.detail,
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
  const chosenAdvisor = savedAdvisor ?? legacyAdvisor;
  const advisorChoices = builtInAdvisorChoices(choices, input, chosenAdvisor);
  const advisor: ModelSetting = {
    id: CROSS_ADVISOR_KEY,
    label: "Advisor",
    kind: "select",
    value: encodeAdvisor(legacyAdvisor) ?? "",
    options: [
      OFF,
      ...advisorChoices.map((choice) => option(choice, chosenAdvisor ? [chosenAdvisor] : [])),
      ...(chosenAdvisor &&
      !known.has(choiceKey(chosenAdvisor)) &&
      !advisorChoices.some((choice) => choice.ref === chosenAdvisor)
        ? [legacyOption(chosenAdvisor)]
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
        ...ceilingLevels(input, savedSubagents).map((value) => ({
          value,
          label: value[0].toUpperCase() + value.slice(1),
        })),
      ],
    },
  ];
}

/**
 * Ceiling levels a subagent can actually reach: the levels offered by the chosen subagent
 * models (every enabled candidate while the choice is Automatic). The saved ceiling stays
 * listed so it remains visible; an empty catalog keeps the full list.
 */
function ceilingLevels(input: DelegationInput, saved: DelegateModelRef[]): string[] {
  const candidates = input.harnesses.flatMap((harness) =>
    input.source.modelsFor(harness).filter((model) => isModelEnabled(model.id)),
  );
  const chosen = saved.length
    ? candidates.filter((model) =>
        saved.some((ref) => ref.harness === model.harness && ref.model === model.id),
      )
    : candidates;
  const offered = new Set(
    (chosen.length ? chosen : candidates).flatMap(
      (model) => modelEffortSetting(model)?.options.map((option) => option.value) ?? [],
    ),
  );
  const current = subagentEffortCeiling(input.values[CROSS_SUBAGENT_MAX_EFFORT_KEY]);
  if (current) offered.add(current);
  const levels = SUBAGENT_EFFORT_LEVELS.filter((level) => offered.has(level));
  return levels.length ? levels : SUBAGENT_EFFORT_LEVELS;
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
  const option: DelegationOption | undefined = setting.options.find((item) => item.value === value);
  if (option?.modelLabel)
    return [option.modelLabel, option.accountLabel, option.detail].filter(Boolean).join(" · ");
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
