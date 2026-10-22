import { describe, expect, it } from "vitest";
import {
  GROUP_LOCK_SETTINGS_DEFAULT,
  parseGroupLockSettings,
  parseUnlockedIds,
} from "./lockSettings";

describe("group lock settings", () => {
  it("defaults to locking again at launch, no auto-lock, no password", () => {
    expect(parseGroupLockSettings(null)).toEqual(GROUP_LOCK_SETTINGS_DEFAULT);
    expect(GROUP_LOCK_SETTINGS_DEFAULT).toMatchObject({
      record: null,
      relockOnLaunch: true,
      startInPrivacyMode: false,
      autoLockMinutes: 0,
      unlockAll: false,
    });
  });

  it("drops a malformed record instead of trusting it", () => {
    const parsed = parseGroupLockSettings(
      JSON.stringify({
        record: { v: 1, alg: "PBKDF2-SHA256" },
        autoLockMinutes: 15,
      }),
    );
    expect(parsed.record).toBeNull();
    expect(parsed.autoLockMinutes).toBe(15);
  });

  it("survives corrupt JSON", () => {
    expect(parseGroupLockSettings("{")).toEqual(GROUP_LOCK_SETTINGS_DEFAULT);
    expect(parseUnlockedIds("{")).toEqual([]);
    expect(parseUnlockedIds('["a", 3, "b"]')).toEqual(["a", "b"]);
  });

  it("keeps existing installs unchanged and only enables privacy startup for a boolean true", () => {
    expect(parseGroupLockSettings('{"relockOnLaunch":false}').startInPrivacyMode).toBe(false);
    expect(parseGroupLockSettings('{"startInPrivacyMode":"true"}').startInPrivacyMode).toBe(false);
    expect(parseGroupLockSettings('{"startInPrivacyMode":true}').startInPrivacyMode).toBe(true);
  });
});
