import { isEffortSettingId, type ModelSetting } from "./models";
import { settingGroupId } from "./modelPickerData";
import { CROSS_SUBAGENTS_KEY } from "../../../shared/model/host-contracts/delegation";
import { IMAGE_MODELS_KEY } from "../../../shared/model/host-contracts/image-models";
import type { ProviderRateLimits } from "../../providers/public/accountUsage";

/**
 * How the account control looks for a given number of accounts: nothing to pick with one,
 * a one-click switch with two, a short list up to five and a searchable list beyond that.
 */
export type AccountSwitcherKind = "none" | "label" | "switch" | "menu" | "search";

export const ACCOUNT_MENU_SEARCH_FROM = 6;

export function accountSwitcherKind(count: number): AccountSwitcherKind {
  if (count <= 0) return "none";
  if (count === 1) return "label";
  if (count === 2) return "switch";
  return count < ACCOUNT_MENU_SEARCH_FROM ? "menu" : "search";
}

/**
 * The inline control a setting gets in the panel, so no setting needs a flyout that could
 * cover the panel: short choices become a segmented switch, up to nine a button grid.
 */
export type SettingControlKind = "toggle" | "effort" | "choices" | "segmented" | "grid" | "list";

const SEGMENTED_MAX = 3;
const GRID_MAX = 9;
/** Characters a segmented switch fits across the settings column. */
const SEGMENTED_TEXT = 22;
/** Longest label that still fits a three-column grid cell. */
const GRID_THREE_TEXT = 7;

/** `labels` are the displayed (translated) option labels, which decide what fits. */
export function settingControlKind(
  setting: ModelSetting,
  labels: readonly string[] = setting.options.map((option) => option.label),
): SettingControlKind {
  if (setting.kind === "toggle") return "toggle";
  if (settingGroupId(setting) === "delegation") return "choices";
  if (isEffortSettingId(setting.id)) return "effort";
  const text = labels.reduce((sum, label) => sum + label.length, 0);
  if (setting.options.length <= SEGMENTED_MAX && text <= SEGMENTED_TEXT) return "segmented";
  return setting.options.length <= GRID_MAX ? "grid" : "list";
}

/** Known reasoning levels, lowest first; `ultra…` levels rank above Max. */
const EFFORT_RANK: Record<string, number> = {
  none: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
  "extra-high": 5,
  max: 6,
};

function effortRank(value: string): number | undefined {
  return /^ultra/i.test(value) ? 7 : EFFORT_RANK[value.toLowerCase()];
}

/**
 * Reasoning options lowest first, as the rising bars read. Some catalogs (Grok) list the
 * levels highest first; those are reversed. Unknown levels keep their catalog order.
 */
export function ascendingEffortOptions<T extends { value: string }>(options: readonly T[]): T[] {
  const ranks = options.map((option) => effortRank(option.value)).filter((rank) => rank != null);
  return ranks.length >= 2 && ranks[0] > ranks[ranks.length - 1]
    ? [...options].reverse()
    : [...options];
}

/** Grid columns: three for short labels such as 200K, two when a label is longer. */
export function settingGridColumns(labels: readonly string[]): 2 | 3 {
  return labels.every((label) => label.length <= GRID_THREE_TEXT) ? 3 : 2;
}

/** Agents-tab rows kept last, in this order, below the single choices. */
const AGENTS_TAIL: readonly string[] = [IMAGE_MODELS_KEY, "subagentPolicy", CROSS_SUBAGENTS_KEY];

/**
 * The panel's Settings tab holds model and context rows; Agents holds delegation rows. The menu
 * order ends with Reasoning beside the upward-opening trigger; the panel reads top-down, so
 * Reasoning leads and context settings follow. On Agents the single choices (Advisor) lead,
 * the subagent policy sits right above the subagents it governs, and the growing subagent list
 * comes last, where it scrolls on its own.
 */
export function splitPanelSettings(settings: readonly ModelSetting[]): {
  model: ModelSetting[];
  agents: ModelSetting[];
} {
  const delegation = settings.filter((setting) => settingGroupId(setting) === "delegation");
  return {
    model: settings.filter((setting) => settingGroupId(setting) !== "delegation").reverse(),
    agents: [
      ...delegation.filter((setting) => !AGENTS_TAIL.includes(setting.id)),
      ...AGENTS_TAIL.flatMap((id) => delegation.filter((setting) => setting.id === id)),
    ],
  };
}

export type AccountUsageSummary = {
  /** Used share of the tightest window, or null without usage data. */
  usedPercent: number | null;
  /** When that window resets, if known and still ahead. */
  resetsAt: number | null;
};

/**
 * Usage of the window with the least headroom. A window whose reset time has passed counts
 * as unused, matching `accountHeadroom`.
 */
export function accountUsageSummary(
  limits: ProviderRateLimits | undefined,
  now: number,
): AccountUsageSummary {
  if (limits?.status !== "ok") return { usedPercent: null, resetsAt: null };
  let tightest: { used: number; resetsAt: number | null } | null = null;
  for (const window of [limits.session, limits.weekly, limits.monthly]) {
    if (!window) continue;
    const expired = window.resetsAt != null && window.resetsAt <= now;
    const used = expired ? 0 : Math.min(100, Math.max(0, window.usedPercent || 0));
    if (!tightest || used > tightest.used)
      tightest = { used, resetsAt: expired ? null : window.resetsAt };
  }
  return tightest
    ? { usedPercent: Math.round(tightest.used), resetsAt: tightest.resetsAt }
    : { usedPercent: null, resetsAt: null };
}
