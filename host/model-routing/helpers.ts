import {
  AUTOMATIC_SUBAGENTS,
  CROSS_ADVISOR_KEY,
  CROSS_DELEGATION_KEYS,
  CROSS_SUBAGENTS_KEY,
  CROSS_SUBAGENT_MAX_EFFORT_KEY,
  decodeAdvisor,
  decodeSubagentSelection,
  delegateRefKey,
  encodeAdvisor,
  encodeSubagents,
  subagentEffortCeiling,
  type DelegateModelRef,
} from "../../src/shared/model/host-contracts/delegation";
import { IMAGE_MODELS_KEY } from "../../src/shared/model/host-contracts/image-models";
import type { ModelRoutingDelegation } from "../../src/shared/model/host-contracts/model-routing";
import {
  lowerEffortCeiling,
  type ResolvedHelpers,
  type WorkHelpers,
} from "../../src/shared/model/host-contracts/work-executor";
import { hostModelRoutingService } from "./runtime";
import type { HostStore } from "../store";

/** The keys Settings > Models layers onto every run; a run's own settings never set them. */
const HELPER_KEYS: readonly string[] = [...CROSS_DELEGATION_KEYS, IMAGE_MODELS_KEY];

/** Model options only: what a provider receives, without the helper policy. */
export function withoutHelperSettings(settings: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(settings).filter(([key]) => !HELPER_KEYS.includes(key)));
}

type Layer = ResolvedHelpers["source"];

/**
 * The one answer to "which helpers does this run get": the work's own choice, then the account,
 * provider and global layers of Settings > Models, then Automatic. Worker, reviewer and crew
 * sessions all call this with their resolved target, so a model chosen by order, pool or fixed
 * entry gets the same policy. The returned `settings` replace any helper keys on the target.
 */
export function resolveHelpers(input: {
  delegation: ModelRoutingDelegation;
  target: { harness: string; providerAccountId?: string };
  helpers?: WorkHelpers;
}): { settings: Record<string, string>; resolved: ResolvedHelpers } {
  const { delegation, target } = input;
  const helpers = input.helpers ?? { mode: "settings" as const };
  const layers: [Layer, Record<string, string> | undefined][] = [
    ["global", delegation.global],
    ["provider", (delegation.providers as Record<string, Record<string, string>>)[target.harness]],
    ["account", delegation.accounts[`${target.harness}\n${target.providerAccountId ?? "default"}`]],
  ];
  const merged: Record<string, string> = {};
  let source: Layer = "default";
  for (const [layer, values] of layers) {
    if (!values) continue;
    for (const key of HELPER_KEYS)
      if (values[key] !== undefined) {
        merged[key] = values[key]!;
        if (key === CROSS_SUBAGENTS_KEY) source = layer;
      }
  }
  const configured = merged[CROSS_SUBAGENTS_KEY] ?? AUTOMATIC_SUBAGENTS;
  const allowed = decodeSubagentSelection(configured);
  const settingsOff = allowed !== AUTOMATIC_SUBAGENTS && allowed.length === 0;
  const settingsCeiling = subagentEffortCeiling(merged[CROSS_SUBAGENT_MAX_EFFORT_KEY]);
  let subagents: ResolvedHelpers["subagents"] = settingsOff ? "off" : allowed;
  let ceiling = settingsCeiling;
  let advisor = decodeAdvisor(merged[CROSS_ADVISOR_KEY]);
  let limited: string | undefined;
  let changesSettings = false;
  let resolvedSource = source;
  if (helpers.mode === "off") {
    changesSettings = !settingsOff;
    subagents = "off";
    advisor = undefined;
    resolvedSource = "task";
  } else if (helpers.mode === "use") {
    resolvedSource = "task";
    const explicit = allowed !== AUTOMATIC_SUBAGENTS && allowed.length > 0 ? allowed : undefined;
    const inList = (ref: DelegateModelRef) =>
      !explicit || explicit.some((entry) => delegateRefKey(entry) === delegateRefKey(ref));
    if (helpers.models?.length) {
      // A task may narrow Settings' list, never add to it.
      const picked = helpers.models.filter(inList);
      if (picked.length < helpers.models.length)
        limited = "Some chosen helper models are outside the allowed list in Settings.";
      if (picked.length) subagents = picked;
      else {
        subagents = "off";
        limited = "The chosen helper models are outside the allowed list in Settings.";
      }
    } else if (settingsOff) subagents = AUTOMATIC_SUBAGENTS;
    changesSettings = settingsOff && subagents !== "off";
    if (helpers.maxEffort) {
      ceiling = lowerEffortCeiling(settingsCeiling, subagentEffortCeiling(helpers.maxEffort));
      if (settingsCeiling && ceiling === settingsCeiling && helpers.maxEffort !== settingsCeiling)
        limited ??= "The effort cap is limited by Settings.";
    }
    if (helpers.advisor === null) advisor = undefined;
    else if (helpers.advisor) {
      if (inList(helpers.advisor)) advisor = helpers.advisor;
      else limited ??= "The chosen advisor is outside the allowed list in Settings.";
    }
  }
  const settings: Record<string, string> = {};
  for (const key of HELPER_KEYS) if (merged[key] !== undefined) settings[key] = merged[key]!;
  delete settings[CROSS_SUBAGENTS_KEY];
  delete settings[CROSS_SUBAGENT_MAX_EFFORT_KEY];
  delete settings[CROSS_ADVISOR_KEY];
  settings[CROSS_SUBAGENTS_KEY] =
    subagents === "off"
      ? "[]"
      : subagents === AUTOMATIC_SUBAGENTS
        ? AUTOMATIC_SUBAGENTS
        : (encodeSubagents(subagents) ?? "[]");
  if (ceiling) settings[CROSS_SUBAGENT_MAX_EFFORT_KEY] = ceiling;
  const encodedAdvisor = advisor ? encodeAdvisor(advisor) : undefined;
  if (encodedAdvisor) settings[CROSS_ADVISOR_KEY] = encodedAdvisor;
  else if (helpers.mode === "off" || helpers.advisor === null) settings[CROSS_ADVISOR_KEY] = "null";
  return {
    settings,
    resolved: {
      mode: helpers.mode,
      subagents,
      ...(ceiling ? { maxEffort: ceiling } : {}),
      ...(advisor ? { advisor } : {}),
      source: resolvedSource,
      ...(limited ? { limited } : {}),
      ...(changesSettings ? { changesSettings: true as const } : {}),
    },
  };
}

/**
 * Resolve the helpers for one run on `target` from the Host's current Settings and write them
 * over the target's own model settings. Reads Settings once; a running session keeps what it got.
 */
export async function applyHelpers<T extends { harness: string; providerAccountId?: string }>(
  store: HostStore,
  target: T & { modelSettings: Record<string, string> },
  helpers?: WorkHelpers,
): Promise<{ modelSettings: Record<string, string>; helpers: ResolvedHelpers }> {
  const { delegation } = await hostModelRoutingService(store).get();
  const { settings, resolved } = resolveHelpers({ delegation, target, helpers });
  return {
    modelSettings: { ...withoutHelperSettings(target.modelSettings), ...settings },
    helpers: resolved,
  };
}
