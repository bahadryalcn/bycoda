import {
  defaultModelSettings,
  isEffortSettingId,
  modelEffortSetting,
  type AgentModel,
} from "../../src/features/sessions/model/models";
import {
  EFFORT_LEVELS,
  subagentEffortCeiling,
  providerModelSettings,
} from "../../src/shared/model/host-contracts/delegation";

function rank(value: string): number {
  const index = EFFORT_LEVELS.indexOf(value.toLowerCase());
  return index < 0 ? -1 : index;
}

/** The parent's reasoning level, from whichever effort setting its provider uses. */
export function parentEffort(settings: Readonly<Record<string, string>>): string | undefined {
  for (const [key, value] of Object.entries(settings))
    if (isEffortSettingId(key) && rank(value) >= 0) return value;
  return undefined;
}

/**
 * Own model defaults, optionally matching a parent's effort (advisors) or an explicit
 * effort (subagents). Use the closest offered level when an exact match is unavailable.
 */
export function childModelSettings(
  model: AgentModel,
  parentSettings: Readonly<Record<string, string>> = {},
  explicitEffort?: string,
  maxEffort?: string,
): Record<string, string> {
  maxEffort = subagentEffortCeiling(maxEffort);
  const settings = providerModelSettings(defaultModelSettings(model));
  if (explicitEffort !== undefined && rank(explicitEffort) < 0)
    throw new Error("Unknown effort level.");
  const wanted =
    explicitEffort ??
    parentEffort(parentSettings) ??
    (maxEffort ? parentEffort(settings) : undefined);
  const effort = modelEffortSetting(model);
  if (!wanted || !effort) return settings;
  const ceiling = maxEffort && rank(maxEffort) >= 0 ? rank(maxEffort) : Infinity;
  const target = Math.min(rank(wanted), ceiling);
  let best: { value: string; distance: number } | undefined;
  for (const option of effort.options) {
    const level = rank(option.value);
    if (level < 0 || level > ceiling) continue;
    const distance = Math.abs(level - target);
    if (!best || distance < best.distance) best = { value: option.value, distance };
  }
  // A model whose every level is above the ceiling still runs, at its lowest level:
  // refusing the run would leave the owner without that model at all.
  if (!best && maxEffort) {
    const lowest = effort.options
      .filter((option) => rank(option.value) >= 0)
      .sort((a, b) => rank(a.value) - rank(b.value))[0];
    if (lowest) best = { value: lowest.value, distance: 0 };
  }
  return best ? { ...settings, [effort.id]: best.value } : settings;
}
