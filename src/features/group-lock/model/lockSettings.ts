import { AUTO_LOCK_DEFAULT, parseAutoLockMinutes, type AutoLockMinutes } from "./autoLock";
import { parsePasswordRecord, type PasswordRecord } from "./passwordRecord";

export type GroupLockSettings = {
  /** `null` until a password is set. */
  record: PasswordRecord | null;
  relockOnLaunch: boolean;
  startInPrivacyMode: boolean;
  autoLockMinutes: AutoLockMinutes;
  /** One correct password opens every locked group. */
  unlockAll: boolean;
};

export const GROUP_LOCK_SETTINGS_DEFAULT: GroupLockSettings = {
  record: null,
  relockOnLaunch: true,
  startInPrivacyMode: false,
  autoLockMinutes: AUTO_LOCK_DEFAULT,
  unlockAll: false,
};

export function parseGroupLockSettings(raw: string | null): GroupLockSettings {
  if (!raw) return GROUP_LOCK_SETTINGS_DEFAULT;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return GROUP_LOCK_SETTINGS_DEFAULT;
    const stored = value as Record<string, unknown>;
    return {
      record: parsePasswordRecord(stored.record),
      relockOnLaunch: stored.relockOnLaunch !== false,
      startInPrivacyMode: stored.startInPrivacyMode === true,
      autoLockMinutes: parseAutoLockMinutes(stored.autoLockMinutes),
      unlockAll: stored.unlockAll === true,
    };
  } catch {
    return GROUP_LOCK_SETTINGS_DEFAULT;
  }
}

export function parseUnlockedIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}
