import {
  isEffortSettingId,
  type AgentModel,
  type ModelSetting,
  type ModelPickerTab,
} from "./models";
import type { HarnessId } from "./session";
import { decodeSubagents } from "../../../shared/model/host-contracts/delegation";
import { offeredDelegationSetting } from "./claudeAdvisor";
import {
  crossDelegationSettings,
  imageModelsSetting,
  crossDelegationSummary,
  isDelegationSetting,
  type DelegationInput,
} from "./crossDelegation";
type ModelGroup = {
  id: string;
  name?: string;
  models: Array<{ item: AgentModel; index: number }>;
};

/** Stable top-to-bottom order: delegation, Context, Fast, Reasoning, then Model.
 * Model and Reasoning stay closest to the upward-opening composer trigger.
 */
const SETTING_ORDER = [
  "subagentPolicy",
  "subagentModel",
  "advisor",
  "crossSubagentMaxEffort",
  "crossSubagents",
  "crossAdvisor",
  "imageModels",
  "autoCompactWindow",
  "autoCompact",
  "context",
  "fast",
  "serviceTier",
  "agent",
  "thinking",
  "variant",
  "reasoningEffort",
  "reasoning",
  "effort",
];

/** A row is locked while extras are frozen, or when its parent setting is off. */
export function isSettingLocked(
  setting: ModelSetting,
  current: AgentModel,
  values: Record<string, string>,
  extrasDisabled: boolean,
): boolean {
  const effectiveValue = (id: string) => {
    const dependent = current.settings?.find((item) => item.id === id);
    return dependent ? settingValue(dependent, values) : undefined;
  };
  return (
    extrasDisabled ||
    (setting.id === "subagentPolicy" &&
      (!effectiveValue("subagentModel") || effectiveValue("subagentModel") === "default") &&
      values.crossSubagents !== "auto" &&
      decodeSubagents(values.crossSubagents).length === 0) ||
    (setting.id === "autoCompactWindow" && effectiveValue("autoCompact") === "off")
  );
}

/** Menu/Extras grouping: delegation first, then Context and model options. */
export type SettingGroupId = "model" | "context" | "delegation";
const CONTEXT_SETTINGS = new Set(["context", "autoCompact", "autoCompactWindow"]);
const DELEGATION_SETTINGS = new Set([
  "advisor",
  "subagentModel",
  "subagentPolicy",
  "crossSubagentMaxEffort",
  "crossSubagents",
  "crossAdvisor",
  "imageModels",
]);

/** English titles of the secondary groups; callers translate them. */
export const SETTING_GROUP_TITLE: Record<SettingGroupId, string> = {
  model: "Model",
  context: "Context",
  delegation: "Agents and images",
};

export function settingGroupId(setting: ModelSetting): SettingGroupId {
  if (CONTEXT_SETTINGS.has(setting.id)) return "context";
  if (DELEGATION_SETTINGS.has(setting.id)) return "delegation";
  return "model";
}

/** Settings split into the ordered groups, empty groups dropped. */
export function groupSettings(
  settings: readonly ModelSetting[],
): Array<{ id: SettingGroupId; settings: ModelSetting[] }> {
  return (["delegation", "context", "model"] as const)
    .map((id) => ({ id, settings: settings.filter((setting) => settingGroupId(setting) === id) }))
    .filter((group) => group.settings.length > 0);
}

/** The select or toggle that carries the Fast state, when the model offers a real on/off pair. */
export function fastSetting(model: AgentModel): ModelSetting | undefined {
  return model.settings?.find(
    (setting) =>
      setting.id === "fast" ||
      setting.id === "serviceTier" ||
      /^fast( mode)?$/i.test(setting.label),
  );
}

/** Values that switch Fast on and off; absent when the setting is not a plain Fast pair. */
export function fastToggleValues(
  setting: ModelSetting | undefined,
): { on: string; off: string } | undefined {
  if (!setting) return undefined;
  const on = setting.options.find(
    (option) => /^(true|fast|priority)$/i.test(option.value) || /^(on|fast)$/i.test(option.label),
  )?.value;
  const off = setting.options.find(
    (option) =>
      /^(false|default|standard|normal)$/i.test(option.value) ||
      /^(off|standard|normal)$/i.test(option.label),
  )?.value;
  return on != null && off != null ? { on, off } : undefined;
}

/** Toolbar pill order: reasoning level first, then the remaining controls. */
const PILL_ORDER = [
  "effort",
  "reasoning",
  "reasoningEffort",
  "variant",
  "fast",
  "thinking",
  "serviceTier",
  "context",
  "advisor",
];

const REASONING_IDS = new Set(["effort", "reasoning", "reasoningEffort"]);

export function isEffortSetting(setting: ModelSetting): boolean {
  return isEffortSettingId(setting.id);
}

export function effortTileTone(
  harness: HarnessId,
  setting: ModelSetting,
  value: string,
): "ultra" | "max" | undefined {
  if (harness !== "codex" || !isEffortSetting(setting)) return undefined;
  const normalized = value.toLowerCase();
  return normalized === "ultra" ? "ultra" : normalized === "max" ? "max" : undefined;
}

export function effortSetting(model: AgentModel): ModelSetting | undefined {
  return model.settings?.find((setting) => setting.kind === "select" && isEffortSetting(setting));
}

export function pickerSettings(model: AgentModel): ModelSetting[] {
  return [...menuVisibleSettings(model)].sort((a, b) => {
    const ai = SETTING_ORDER.indexOf(a.id);
    const bi = SETTING_ORDER.indexOf(b.id);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
}

/** Settings without the OpenCode agent row, which never shows in the menu. */
export function menuVisibleSettings(model: AgentModel): ModelSetting[] {
  return (model.settings ?? []).filter(
    (setting) => !(model.harness === "opencode" && setting.id === "agent"),
  );
}

/** Standalone toolbar pills, reasoning level first. */
export function pillSettings(model: AgentModel): ModelSetting[] {
  return [...menuVisibleSettings(model)]
    .filter((setting) => !["advisor", "subagentModel"].includes(setting.id))
    .sort((a, b) => {
      const ai = PILL_ORDER.indexOf(a.id);
      const bi = PILL_ORDER.indexOf(b.id);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
}

/** One display name per setting meaning, whatever label the provider catalog uses. */
export function settingLabel(setting: ModelSetting): string {
  return REASONING_IDS.has(setting.id) ? "Reasoning" : setting.label;
}

export function settingValue(setting: ModelSetting, values: Record<string, string>): string {
  return values[setting.id] ?? setting.value;
}

/** Every menu and Extras row: catalog settings, then the any-provider delegation rows. */
export function menuSettings(input: DelegationInput): ModelSetting[] {
  const offered = input.source.modelsFor(input.current.harness);
  return groupSettings([
    ...pickerSettings(input.current)
      .filter((setting) => !["advisor", "subagentModel"].includes(setting.id))
      .map((setting) =>
        offeredDelegationSetting(
          setting,
          offered,
          settingValue(setting, input.values),
          input.current,
        ),
      ),
    ...crossDelegationSettings(input),
    imageModelsSetting(input),
  ]).flatMap((group) => group.settings);
}

export function settingValueLabel(setting: ModelSetting, values: Record<string, string>): string {
  if (isDelegationSetting(setting)) return crossDelegationSummary(setting, values);
  const value = settingValue(setting, values);
  return setting.options.find((option) => option.value === value)?.label ?? value;
}

export function recentMenuModels(
  current: AgentModel,
  source: { find(id: string): AgentModel | undefined },
  choices: readonly { model: string; harness: HarnessId }[],
): AgentModel[] {
  const models = choices.flatMap((choice) => {
    const item = source.find(choice.model);
    return item?.harness === choice.harness ? [item] : [];
  });
  if (!models.some((item) => item.id === current.id)) models.push(current);
  return models.slice(0, 6);
}

export function modelGroups(tab: ModelPickerTab, models: AgentModel[]): ModelGroup[] {
  if (tab !== "opencode") {
    return [
      {
        id: "models",
        models: models.map((item, index) => ({ item, index })),
      },
    ];
  }

  const groups = new Map<string, ModelGroup>();
  models.forEach((item, index) => {
    const provider = item.provider ?? { id: "opencode", name: "OpenCode" };
    let group = groups.get(provider.id);
    if (!group) {
      group = { id: provider.id, name: provider.name, models: [] };
      groups.set(provider.id, group);
    }
    group.models.push({ item, index });
  });
  return [...groups.values()];
}
