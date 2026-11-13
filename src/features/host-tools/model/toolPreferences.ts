import { validBrowserHome, validBrowserSearchTemplate } from "./browserAddress";
import { createStoredSetting } from "../../../shared/lib/storedSetting";

function preference<T extends string | number | boolean>(
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
    save(value: T) {
      if (!valid(value)) throw new Error(`Invalid tool preference: ${name}`);
      try {
        localStorage.setItem(key, JSON.stringify(value));
        if (localStorage.getItem(key) !== JSON.stringify(value)) throw new Error();
      } catch {
        throw new Error(`Could not save tool preference: ${name}`);
      }
      if (typeof window !== "undefined")
        window.dispatchEvent(new CustomEvent(`${key}.changed`, { detail: value }));
    },
  };
}

const oneOf =
  <T extends string | number>(values: readonly T[]) =>
  (value: unknown): value is T =>
    values.some((item) => item === value);
const boolean = (value: unknown): value is boolean => typeof value === "boolean";

export const toolPreferences = {
  browserViewport: preference(
    "browserViewport",
    "desktop" as "desktop" | "tablet" | "phone" | "custom",
    oneOf(["desktop", "tablet", "phone", "custom"] as const),
  ),
  browserViewportWidth: preference(
    "browserViewportWidth",
    1280,
    (value): value is number =>
      typeof value === "number" && Number.isInteger(value) && value >= 240 && value <= 2560,
  ),
  browserViewportHeight: preference(
    "browserViewportHeight",
    720,
    (value): value is number =>
      typeof value === "number" && Number.isInteger(value) && value >= 240 && value <= 2160,
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
  browserLiveView: preference("browserLiveView", true, boolean),
  browserActualSize: preference("browserActualSize", false, boolean),
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
  serversRefreshInterval: preference(
    "serversRefreshInterval",
    15000 as 15000 | 30000 | 60000,
    oneOf([15000, 30000, 60000] as const),
  ),
};
export type ToolPreferenceKey = keyof typeof toolPreferences;

export function browserDefaultViewport() {
  switch (toolPreferences.browserViewport.load()) {
    case "custom":
      return {
        width: toolPreferences.browserViewportWidth.load(),
        height: toolPreferences.browserViewportHeight.load(),
      };
    case "tablet":
      return { width: 768, height: 1024 };
    case "phone":
      return { width: 390, height: 844 };
    default:
      return { width: 1280, height: 720 };
  }
}
