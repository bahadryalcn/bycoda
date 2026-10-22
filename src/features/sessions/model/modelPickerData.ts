import {
  isEffortSettingId,
  type AgentModel,
  type ModelSetting,
  type ModelPickerTab,
} from "./models";
import type { HarnessId } from "./session";
type ModelGroup = {
  id: string;
  name?: string;
  models: Array<{ item: AgentModel; index: number }>;
};

const SETTING_ORDER = [
  "effort",
  "reasoning",
  "reasoningEffort",
  "serviceTier",
  "fast",
  "thinking",
  "variant",
  "agent",
  "context",
  "autoCompact",
  "autoCompactWindow",
  "advisor",
  "subagentModel",
  "subagentPolicy",
];

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
  return [...menuVisibleSettings(model)].sort((a, b) => {
    const ai = PILL_ORDER.indexOf(a.id);
    const bi = PILL_ORDER.indexOf(b.id);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
}

export function settingLabel(setting: ModelSetting): string {
  return setting.id === "effort" || setting.id === "reasoning" ? "Effort" : setting.label;
}

export function settingValue(setting: ModelSetting, values: Record<string, string>): string {
  return values[setting.id] ?? setting.value;
}

export function settingValueLabel(setting: ModelSetting, values: Record<string, string>): string {
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
