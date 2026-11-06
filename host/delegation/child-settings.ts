import {
  defaultModelSettings,
  isEffortSettingId,
  modelEffortSetting,
  type AgentModel,
} from "../../src/features/sessions/model/models";
import { providerModelSettings } from "../../src/shared/model/host-contracts/delegation";

/** Reasoning levels from least to most effort, across providers' spellings. */
const LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

function rank(value: string): number {
  const index = LEVELS.indexOf(value.toLowerCase());
  return index < 0 ? -1 : index;
}

/** The parent's reasoning level, from whichever effort setting its provider uses. */
export function parentEffort(settings: Readonly<Record<string, string>>): string | undefined {
  for (const [key, value] of Object.entries(settings))
    if (isEffortSettingId(key) && rank(value) >= 0) return value;
  return undefined;
}

/**
 * A child's own model defaults, with its reasoning level matched to the parent's:
 * the same level when offered, otherwise the closest one the child offers.
 */
export function childModelSettings(
  model: AgentModel,
  parentSettings: Readonly<Record<string, string>>,
): Record<string, string> {
  const settings = providerModelSettings(defaultModelSettings(model));
  const wanted = parentEffort(parentSettings);
  const effort = modelEffortSetting(model);
  if (!wanted || !effort) return settings;
  const target = rank(wanted);
  let best: { value: string; distance: number } | undefined;
  for (const option of effort.options) {
    const level = rank(option.value);
    if (level < 0) continue;
    const distance = Math.abs(level - target);
    if (!best || distance < best.distance) best = { value: option.value, distance };
  }
  return best ? { ...settings, [effort.id]: best.value } : settings;
}
