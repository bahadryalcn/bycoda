import {
  BROWSER_VIEWPORT_MAX_HEIGHT,
  BROWSER_VIEWPORT_MAX_WIDTH,
  BROWSER_VIEWPORT_PRESETS,
  validBrowserViewportDimension,
} from "../../../shared/lib/browserViewport";
import { validBrowserHome, validBrowserSearchTemplate } from "./browserAddress";
import { createStoredSetting } from "../../../shared/lib/storedSetting";

function preference<T extends string | number | boolean | readonly string[]>(
  name: string,
  fallback: T,
  valid: (value: unknown) => value is T,
) {
  const key = `bycoda.toolPreferences.${name}.v1`;
  const setting = createStoredSetting<T>({
    key,
    fallback,
    event: `${key}.changed`,
    storageEvents: true,
    parse: (raw) => {
      const value: unknown = JSON.parse(raw);
      return valid(value) ? value : fallback;
    },
    serialize: (value) => JSON.stringify(value),
  });
  return {
    ...setting,
    /** Storage key; reset needs it to snapshot and restore the raw stored value. */
    key,
    /** Canonical default shown by Settings; the only copy of this value. */
    defaultValue: fallback,
    save(value: T) {
      if (!valid(value)) throw new Error(`Invalid tool preference: ${name}`);
      writeVerified(key, JSON.stringify(value), name);
      announce(key, value);
    },
  };
}

/** Durable write: the value must read back exactly, otherwise the save did not happen. */
function writeVerified(key: string, raw: string, name: string) {
  try {
    localStorage.setItem(key, raw);
    if (localStorage.getItem(key) !== raw) throw new Error();
  } catch {
    throw new Error(`Could not save tool preference: ${name}`);
  }
}

function announce(key: string, value: unknown) {
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent(`${key}.changed`, { detail: value }));
}

const oneOf =
  <T extends string | number>(values: readonly T[]) =>
  (value: unknown): value is T =>
    values.some((item) => item === value);
const boolean = (value: unknown): value is boolean => typeof value === "boolean";
/** Machine IDs: bounded so a corrupt value cannot grow without limit. */
const machineIds = (value: unknown): value is readonly string[] =>
  Array.isArray(value) &&
  value.length <= 200 &&
  value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 300);

export const toolPreferences = {
  browserViewport: preference(
    "browserViewport",
    BROWSER_VIEWPORT_PRESETS[0].id as (typeof BROWSER_VIEWPORT_PRESETS)[number]["id"] | "custom",
    oneOf([...BROWSER_VIEWPORT_PRESETS.map(({ id }) => id), "custom"] as const),
  ),
  browserViewportWidth: preference("browserViewportWidth", 1280, (value): value is number =>
    validBrowserViewportDimension(value, BROWSER_VIEWPORT_MAX_WIDTH),
  ),
  browserViewportHeight: preference("browserViewportHeight", 720, (value): value is number =>
    validBrowserViewportDimension(value, BROWSER_VIEWPORT_MAX_HEIGHT),
  ),
  browserHomeUrl: preference("browserHomeUrl", "http://localhost:3000", validBrowserHome),
  browserSearchEngine: preference(
    "browserSearchEngine",
    "disabled" as "disabled" | "duckduckgo" | "google" | "bing" | "custom",
    oneOf(["disabled", "duckduckgo", "google", "bing", "custom"] as const),
  ),
  browserSearchTemplate: preference(
    "browserSearchTemplate",
    "https://duckduckgo.com/?q={query}",
    validBrowserSearchTemplate,
  ),
  browserDevelopmentUsesImportedProfile: preference(
    "browserDevelopmentUsesImportedProfile",
    false,
    boolean,
  ),
  browserLiveView: preference("browserLiveView", true, boolean),
  browserActualSize: preference("browserActualSize", false, boolean),
  devicesEnabled: preference("devicesEnabled", true, boolean),
  /** Saved machines the owner removed from Device sources; the Devices picker skips them. */
  deviceHiddenMachines: preference("deviceHiddenMachines", [] as readonly string[], machineIds),
  deviceAutoLive: preference("deviceAutoLive", true, boolean),
  devicePreviewScale: preference(
    "devicePreviewScale",
    1 as 1 | 1.5 | 2 | 3,
    oneOf([1, 1.5, 2, 3] as const),
  ),
  logsFollow: preference("logsFollow", true, boolean),
  logsGrouped: preference("logsGrouped", true, boolean),
  logsRefreshInterval: preference(
    "logsRefreshInterval",
    1500 as 1500 | 3000 | 5000,
    oneOf([1500, 3000, 5000] as const),
  ),
  serversAutoRefresh: preference("serversAutoRefresh", true, boolean),
  bykitInstructions: preference("bykitInstructions", true, boolean),
  serversRefreshInterval: preference(
    "serversRefreshInterval",
    15000 as 15000 | 30000 | 60000,
    oneOf([15000, 30000, 60000] as const),
  ),
};
export type ToolPreferenceKey = keyof typeof toolPreferences;

/** Reset could not be undone completely: `unrestored` keys may now hold a default or a mix. */
export class ToolPreferencesResetError extends Error {
  constructor(readonly unrestored: readonly ToolPreferenceKey[]) {
    super(`Could not restore tool preferences: ${unrestored.join(", ")}`);
    this.name = "ToolPreferencesResetError";
  }
}

/**
 * Restore only `names` to their canonical defaults as one unit. Values already at the default
 * (or never saved) are not rewritten. If a write fails, every value changed so far is put back;
 * a failed rollback throws `ToolPreferencesResetError` naming what stayed changed. Any other
 * thrown error means nothing changed. Unlisted preferences are never touched.
 */
export function resetToolPreferences(names: readonly ToolPreferenceKey[]): void {
  let plan: { name: ToolPreferenceKey; key: string; raw: string; previous: string }[];
  try {
    plan = names.flatMap((name) => {
      const { key, defaultValue } = toolPreferences[name];
      const raw = JSON.stringify(defaultValue);
      const previous = localStorage.getItem(key);
      return previous === null || previous === raw ? [] : [{ name, key, raw, previous }];
    });
  } catch {
    throw new Error("Could not read tool preferences");
  }
  const attempted: typeof plan = [];
  try {
    for (const change of plan) {
      attempted.push(change);
      writeVerified(change.key, change.raw, change.name);
    }
  } catch (failure) {
    const unrestored: ToolPreferenceKey[] = [];
    for (const change of attempted) {
      try {
        writeVerified(change.key, change.previous, change.name);
      } catch {
        unrestored.push(change.name);
        announce(change.key, toolPreferences[change.name].load());
      }
    }
    if (unrestored.length > 0) throw new ToolPreferencesResetError(unrestored);
    throw failure;
  }
  for (const change of plan) announce(change.key, toolPreferences[change.name].defaultValue);
}

export function browserDefaultViewport() {
  const selected = toolPreferences.browserViewport.load();
  if (selected === "custom") {
    return {
      width: toolPreferences.browserViewportWidth.load(),
      height: toolPreferences.browserViewportHeight.load(),
    };
  }
  const { width, height } =
    BROWSER_VIEWPORT_PRESETS.find(({ id }) => id === selected) ?? BROWSER_VIEWPORT_PRESETS[0];
  return { width, height };
}
