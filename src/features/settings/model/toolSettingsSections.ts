import { t } from "../../../shared/i18n/core";
import type { SettingsEntry, SettingsSection } from "./settings";

export const TOOL_SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "tools",
    group: "tools",
    get label() {
      return t("Conversation tools");
    },
    get description() {
      return t("Browser, devices, logs and development server defaults.");
    },
    keywords:
      "browser device phone emulator simulator viewport live preview scale logs tail grouped development dev servers localhost refresh interval bykit agent instructions files search edit scripts",
  },
];

export const TOOL_SETTINGS_TAB_ANCHORS = {
  browser: "browser-viewport",
  devices: "device-auto-live",
  logs: "logs-follow",
  devServers: "servers-auto-refresh",
  bykit: "bykit-instructions",
} as const;
export type ToolSettingsTab = keyof typeof TOOL_SETTINGS_TAB_ANCHORS;

export function toolSettingsTabForSection(section: unknown): ToolSettingsTab | null {
  return typeof section === "string" &&
    Object.prototype.hasOwnProperty.call(TOOL_SETTINGS_TAB_ANCHORS, section)
    ? (section as ToolSettingsTab)
    : null;
}

export function toolSettingsAnchorForSection(section: unknown) {
  const tab = toolSettingsTabForSection(section);
  return tab ? TOOL_SETTINGS_TAB_ANCHORS[tab] : null;
}

export function toolSettingsTabForAnchor(anchor: string | null): ToolSettingsTab | null {
  if (anchor?.startsWith("browser-")) return "browser";
  if (anchor?.startsWith("device-")) return "devices";
  if (anchor?.startsWith("logs-")) return "logs";
  if (anchor?.startsWith("servers-")) return "devServers";
  return null;
}

export const TOOL_SETTINGS_INDEX: SettingsEntry[] = [
  {
    id: "browser-viewport-width",
    section: "tools",
    get label() {
      return t("Width");
    },
    keywords: "browser custom viewport pixels",
  },
  {
    id: "browser-viewport-height",
    section: "tools",
    get label() {
      return t("Height");
    },
    keywords: "browser custom viewport pixels",
  },
  {
    id: "browser-home-url",
    section: "tools",
    get label() {
      return t("Initial address");
    },
    keywords: "browser home default url website",
  },
  {
    id: "browser-search-engine",
    section: "tools",
    get label() {
      return t("Search engine");
    },
    keywords: "browser address search duckduckgo google bing custom disabled",
  },
  {
    id: "browser-search-template",
    section: "tools",
    get label() {
      return t("Search URL template");
    },
    keywords: "browser custom search query engine",
  },
  {
    id: "browser-viewport",
    section: "tools",
    get label() {
      return t("Default viewport");
    },
    keywords: "desktop tablet phone browser width height",
  },
  {
    id: "browser-live-view",
    section: "tools",
    get label() {
      return t("Live view by default");
    },
    keywords: "browser preview streaming",
  },
  {
    id: "browser-actual-size",
    section: "tools",
    get label() {
      return t("Actual size by default");
    },
    keywords: "browser scale fit",
  },
  {
    id: "device-enabled",
    section: "tools",
    get label() {
      return t("Use devices");
    },
    keywords: "devices panel simulator emulator hub enable disable",
  },
  {
    id: "device-agent-access",
    section: "tools",
    get label() {
      return t("Agents can use devices");
    },
    keywords: "devices agents agent-device simulator emulator permission access",
  },
  {
    id: "device-sources",
    section: "tools",
    get label() {
      return t("Device sources");
    },
    keywords: "devices machines computers remote mac ssh host simulator emulator test connection",
  },
  {
    id: "device-auto-live",
    section: "tools",
    get label() {
      return t("Live view by default");
    },
    keywords: "device preview streaming phone emulator",
  },
  {
    id: "device-preview-scale",
    section: "tools",
    get label() {
      return t("Preview scale");
    },
    keywords: "device zoom size",
  },
  {
    id: "logs-follow",
    section: "tools",
    get label() {
      return t("Follow new logs");
    },
    keywords: "tail scroll",
  },
  {
    id: "logs-grouped",
    section: "tools",
    get label() {
      return t("Group repeated logs");
    },
    keywords: "duplicates grouping",
  },
  {
    id: "logs-refresh-interval",
    section: "tools",
    get label() {
      return t("Refresh interval");
    },
    keywords: "logs polling frequency",
  },
  {
    id: "servers-auto-refresh",
    section: "tools",
    get label() {
      return t("Automatic refresh");
    },
    keywords: "development servers polling",
  },
  {
    id: "servers-refresh-interval",
    section: "tools",
    get label() {
      return t("Refresh interval");
    },
    keywords: "development servers polling frequency",
  },
  {
    id: "bykit-instructions",
    section: "providers",
    get label() {
      return t("Tell agents to use bykit");
    },
    keywords: "bykit agent instructions files search edit scripts command line",
  },
];
