import type { SearchableSelectOption } from "../../../shared/ui/SearchableSelect";
import { WandSparkles, X } from "../../../shared/ui/icons";
import {
  delegationOptionHarness,
  isDelegationSetting,
  isImageModelsSetting,
  isSubagentSetting,
  delegationShortLabel,
  type DelegationOption,
} from "../model/crossDelegation";
import type { ModelSetting } from "../model/models";
import type { HarnessId } from "../model/session";
import { HarnessIcon } from "./HarnessIcon";
import { ModelAccountLabel, ModelAccountNumber } from "./ModelAccountIdentity";
import { HARNESS_TITLE } from "../../../shared/model/harnessIdentity";
import { CROSS_ADVISOR_KEY, decodeAdvisor } from "../../../shared/model/host-contracts/delegation";
import {
  IMAGE_MODEL_INFO,
  type ImageModelId,
} from "../../../shared/model/host-contracts/image-models";

const providerIcon = (harness: HarnessId | undefined) =>
  harness ? <HarnessIcon harness={harness} className="size-3.5 shrink-0" /> : undefined;

/** The provider icon of one any-provider delegation option; nothing for Off. */
export function DelegationOptionIcon({
  setting,
  value,
  showAccountNumber = true,
}: {
  setting: ModelSetting;
  value: string;
  /** Fixed-size picker icon slots only hold the provider glyph. */
  showAccountNumber?: boolean;
}) {
  if (value === "auto") return <WandSparkles className="icon-sm shrink-0" />;
  if (value === "" && setting.options.find((option) => option.value === "")?.label === "Off")
    return <X className="icon-sm shrink-0" />;
  if (value === "" && setting.options.find((option) => option.value === "")?.label !== "Off")
    return <WandSparkles className="icon-sm shrink-0" />;
  if (isImageModelsSetting(setting)) {
    const harness = IMAGE_MODEL_INFO[value as ImageModelId]?.harness;
    return harness ? providerIcon(harness) : null;
  }
  const ref = isDelegationSetting(setting) ? decodeAdvisor(value) : undefined;
  const option: DelegationOption | undefined = setting.options.find((item) => item.value === value);
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {providerIcon(ref?.harness)}
      {showAccountNumber ? <ModelAccountNumber account={option} /> : null}
    </span>
  );
}

/**
 * One delegation choice rendered like the composer's model picker: provider icon, model name,
 * the account as a numbered tag with its name, grouped by provider. Searchable by provider and
 * account too. The account sits in its own slot, so it never overlaps the model name.
 */
export function delegationPickerOption(
  setting: ModelSetting,
  option: DelegationOption,
  t: (text: string) => string,
): SearchableSelectOption {
  const harness = isImageModelsSetting(setting)
    ? IMAGE_MODEL_INFO[option.value as ImageModelId]?.harness
    : delegationOptionHarness(setting, option.value);
  const provider = harness ? HARNESS_TITLE[harness] : undefined;
  // An advisor model several accounts offer names its account, so the closed field tells them
  // apart. An unavailable choice keeps its full "Unavailable: …" label.
  const advisorLabel =
    setting.id === CROSS_ADVISOR_KEY && option.modelLabel
      ? delegationSelectChoice(setting, option, t).label
      : undefined;
  const name = option.modelLabel ?? delegationShortLabel(setting, option.value, t(option.label));
  const label = advisorLabel ?? name;
  return {
    value: option.value,
    label,
    keywords: [provider, option.accountLabel, option.detail].filter(Boolean).join(" "),
    icon: providerIcon(harness),
    meta: option.accountLabel ? (
      label === name ? (
        <ModelAccountLabel account={{ ...option, accountLabel: option.accountLabel }} />
      ) : (
        <ModelAccountNumber account={option} />
      )
    ) : undefined,
    description: option.detail,
    group: provider,
    disabled: "disabled" in option && option.disabled === true,
  };
}

/** Picker options for every model choice of a setting, deduplicated and grouped by provider. */
export function delegationPickerOptions(
  setting: ModelSetting,
  t: (text: string) => string,
): SearchableSelectOption[] {
  const seen = new Set<string>();
  const options = setting.options.flatMap((option) => {
    const choice = isImageModelsSetting(setting)
      ? option.value !== ""
      : !!decodeAdvisor(option.value);
    if (!choice || seen.has(option.value)) return [];
    seen.add(option.value);
    return [delegationPickerOption(setting, option, t)];
  });
  // Consecutive options share a heading, so keep each provider's rows together in first-seen order.
  const order = [...new Set(options.map((option) => option.group))];
  return options.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
}

/** The account of a model choice: its numbered colour tag and name, as the composer shows it. */
/** Model as primary text, provider/account as quiet same-line metadata. */
function delegationSelectChoice(
  setting: ModelSetting,
  option: ModelSetting["options"][number],
  t: (text: string) => string,
) {
  const ref = isDelegationSetting(setting) ? decodeAdvisor(option.value) : undefined;
  const group =
    ref &&
    new Set(setting.options.map((item) => decodeAdvisor(item.value)?.harness).filter(Boolean))
      .size > 1
      ? HARNESS_TITLE[ref.harness]
      : undefined;
  if (isSubagentSetting(setting)) {
    return {
      label: delegationShortLabel(setting, option.value, t(option.label)),
      group,
    };
  }
  const parts = option.label.split(" · ");
  const model = ref && parts.length > 1 ? parts[1] : undefined;
  // The same model offered by several accounts needs the account in its name, or a summary of
  // the selection ("Haiku 5.5, Fable 5.2, Haiku 5.5") cannot tell the copies apart.
  const shared =
    ref &&
    model &&
    parts.length > 2 &&
    setting.options.filter((item) => item.label.split(" · ")[1] === model).length > 1;
  return {
    label: model ? (shared ? [model, ...parts.slice(2)].join(" · ") : model) : t(option.label),
    meta: ref
      ? [HARNESS_TITLE[ref.harness], ...(shared ? [] : parts.slice(2))].join(" · ")
      : undefined,
    group,
  };
}
