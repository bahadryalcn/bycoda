import { NotificationSettings, defaultNotificationSettings } from "@bycoda/account-contracts";
import { describe, expect, it } from "vitest";
import {
  isChannelApplicable,
  isChannelOn,
  isLocked,
  setChannel,
  setDailySummaryTime,
  setEmailDigest,
  setPushDetails,
  setQuietHours,
  userNotificationEvents,
} from "./notificationSettingsModel";

describe("notification settings model", () => {
  const base = defaultNotificationSettings();

  it("toggles one event and channel and stays valid", () => {
    const off = setChannel(base, "agent.finished", "os", false);
    expect(isChannelOn(off, "agent.finished", "os")).toBe(false);
    expect(isChannelOn(off, "agent.finished", "push")).toBe(true);
    expect(NotificationSettings.safeParse(off).success).toBe(true);
    const on = setChannel(off, "agent.finished", "email", true);
    expect(isChannelOn(on, "agent.finished", "email")).toBe(true);
  });

  it("never switches off a mandatory event", () => {
    expect(isLocked("account.new_device_sign_in")).toBe(true);
    const attempt = setChannel(base, "account.new_device_sign_in", "email", false);
    expect(attempt).toBe(base);
    expect(isChannelOn(attempt, "account.new_device_sign_in", "email")).toBe(true);
  });

  it("lists user events only", () => {
    expect(userNotificationEvents().every((event) => event.audience === "user")).toBe(true);
  });

  it("sets quiet hours and ignores an empty window", () => {
    const quiet = setQuietHours(base, {
      start: "22:00",
      end: "07:00",
      timeZone: "Europe/Istanbul",
    });
    expect(quiet.quietHours?.start).toBe("22:00");
    expect(
      setQuietHours(quiet, { start: "08:00", end: "08:00", timeZone: "UTC" }).quietHours,
    ).toBeNull();
    expect(setQuietHours(quiet, null).quietHours).toBeNull();
  });

  it("push details stay off unless chosen", () => {
    expect(base.pushShowDetails).toBe(false);
    expect(setPushDetails(base, true).pushShowDetails).toBe(true);
  });

  it("keeps the daily summary e-mail toggle and its matrix cell as one value", () => {
    expect(isChannelOn(base, "summary.daily", "email")).toBe(false);
    const viaToggle = setEmailDigest(base, true);
    expect(viaToggle.emailDigest).toBe(true);
    expect(isChannelOn(viaToggle, "summary.daily", "email")).toBe(true);
    const viaCell = setChannel(base, "summary.daily", "email", true);
    expect(viaCell.emailDigest).toBe(true);
    const off = setChannel(viaCell, "summary.daily", "email", false);
    expect(off.emailDigest).toBe(false);
    expect(
      off.preferences.filter((p) => p.event === "summary.daily" && p.channel === "email"),
    ).toHaveLength(1);
    expect(NotificationSettings.safeParse(off).success).toBe(true);
  });

  it("hides e-mail cells the server never sends", () => {
    expect(isChannelApplicable("summary.daily", "email")).toBe(true);
    expect(isChannelApplicable("account.new_device_sign_in", "email")).toBe(true);
    expect(isChannelApplicable("agent.finished", "email")).toBe(false);
    expect(isChannelApplicable("agent.finished", "push")).toBe(true);
  });

  it("changes the digest time and ignores an empty one", () => {
    expect(setDailySummaryTime(base, "07:30").dailySummaryTime).toBe("07:30");
    expect(setDailySummaryTime(base, "")).toBe(base);
  });
});
