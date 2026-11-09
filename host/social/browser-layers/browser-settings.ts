import type { BrowserVisibility } from "./types";
import type { SettingsStore } from "./record-index";

export type BrowserSettings = {
  accountId: string;
  visibility: BrowserVisibility;
  desktopControl: { allowed: boolean; computerId?: string };
};

const MAX_ID = 200;
const key = (accountId: string) => `browser-layers.settings.${accountId}`;

/** Hidden by default; desktop control stays off until the owner enables it for this account. */
export function defaultBrowserSettings(accountId: string): BrowserSettings {
  return { accountId, visibility: "hidden", desktopControl: { allowed: false } };
}

function boundedId(value: unknown): string | undefined {
  return typeof value === "string" && value.length >= 1 && value.length <= MAX_ID
    ? value
    : undefined;
}

/** Strict parser for owner input and stored rows; unknown keys are dropped. Throws on invalid shape. */
export function parseBrowserSettings(input: unknown): BrowserSettings {
  if (!input || typeof input !== "object") throw new RangeError("Browser settings are invalid.");
  const value = input as Record<string, unknown>;
  const accountId = boundedId(value.accountId);
  if (!accountId) throw new RangeError("Browser account is invalid.");
  if (value.visibility !== "hidden" && value.visibility !== "visible")
    throw new RangeError("Browser visibility is invalid.");
  const control = value.desktopControl as Record<string, unknown> | undefined;
  if (!control || typeof control !== "object" || typeof control.allowed !== "boolean")
    throw new RangeError("Desktop control setting is invalid.");
  const computerId = control.computerId === undefined ? undefined : boundedId(control.computerId);
  if (control.computerId !== undefined && !computerId)
    throw new RangeError("Desktop computer is invalid.");
  return {
    accountId,
    visibility: value.visibility,
    desktopControl: computerId
      ? { allowed: control.allowed, computerId }
      : { allowed: control.allowed },
  };
}

/** A missing, corrupt or mismatched row reads as the safe default (hidden, desktop control off). */
export async function readBrowserSettings(
  store: SettingsStore,
  accountId: string,
): Promise<BrowserSettings> {
  const raw = await store.getSetting(key(accountId));
  if (raw === undefined) return defaultBrowserSettings(accountId);
  try {
    const parsed = parseBrowserSettings(JSON.parse(raw));
    return parsed.accountId === accountId ? parsed : defaultBrowserSettings(accountId);
  } catch {
    return defaultBrowserSettings(accountId);
  }
}

export async function writeBrowserSettings(
  store: SettingsStore,
  input: unknown,
): Promise<BrowserSettings> {
  const settings = parseBrowserSettings(input);
  await store.putSetting(key(settings.accountId), JSON.stringify(settings));
  return settings;
}
