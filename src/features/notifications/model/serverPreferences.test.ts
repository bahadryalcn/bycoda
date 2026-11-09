// @vitest-environment happy-dom
import { defaultNotificationSettings } from "@bycoda/account-contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { loadDailySummaryTime } from "./dailySummarySettings";
import { loadNotificationEvents } from "./notificationEvents";
import {
  applyToServerSettings,
  mergeField,
  mergeSettings,
  readLocalSnapshot,
  readServerSnapshot,
  writeLocalSnapshot,
} from "./serverPreferences";

const defaults = { local: "09:00", server: "18:00" };

describe("mergeField", () => {
  it("keeps the account value on first sync, unless it is still the factory default", () => {
    expect(mergeField(undefined, "09:00", "20:00", defaults)).toEqual({
      value: "20:00",
      from: "server",
    });
    expect(mergeField(undefined, "07:00", "18:00", defaults)).toEqual({
      value: "07:00",
      from: "local",
    });
    expect(mergeField(undefined, "09:00", "18:00", defaults)).toEqual({
      value: "18:00",
      from: "server",
    });
  });

  it("lets the side that changed since the last sync win, and the account win a conflict", () => {
    expect(mergeField("10:00", "11:00", "10:00", defaults).from).toBe("local");
    expect(mergeField("10:00", "10:00", "12:00", defaults).from).toBe("server");
    expect(mergeField("10:00", "11:00", "12:00", defaults)).toEqual({
      value: "12:00",
      from: "server",
    });
    expect(mergeField("10:00", "10:00", "10:00", defaults).from).toBe("same");
  });

  it("pushes the local value when the account has no setting", () => {
    expect(mergeField(undefined, true, undefined, { local: true, server: false })).toEqual({
      value: true,
      from: "local",
    });
  });
});

describe("local and server settings", () => {
  beforeEach(() => localStorage.clear());

  it("reads the existing local daily summary setting and the event toggles", () => {
    expect(readLocalSnapshot()).toMatchObject({
      dailySummaryTime: "09:00",
      "os:summary.daily": true,
      "os:agent.finished": true,
    });
  });

  it("adopts the account's summary time without touching other local settings", () => {
    const server = { ...defaultNotificationSettings(), dailySummaryTime: "20:30" };
    const merge = mergeSettings({
      base: null,
      local: readLocalSnapshot(),
      server: readServerSnapshot(server),
    });
    expect(merge.toLocal).toEqual({ dailySummaryTime: "20:30" });
    writeLocalSnapshot(merge.toLocal);
    expect(loadDailySummaryTime()).toBe("20:30");
    expect(loadNotificationEvents()).toEqual({
      finished: true,
      input: true,
      failed: true,
      taskbar: true,
    });
  });

  it("sends a customised local time to a fresh account and creates the missing summary channel", () => {
    localStorage.setItem("bycoda.notifications.dailySummary.time", "07:00");
    const server = defaultNotificationSettings();
    const merge = mergeSettings({
      base: null,
      local: readLocalSnapshot(),
      server: readServerSnapshot(server),
    });
    expect(merge.toServer).toEqual({ dailySummaryTime: "07:00", "os:summary.daily": true });
    const next = applyToServerSettings(server, merge.toServer);
    expect(next.dailySummaryTime).toBe("07:00");
    expect(next.preferences).toContainEqual({
      scope: "user",
      event: "summary.daily",
      channel: "os",
      enabled: true,
    });
    // Everything else is kept.
    expect(next.quietHours).toBe(server.quietHours);
    expect(next.preferences.filter((p) => p.event === "agent.finished")).toEqual(
      server.preferences.filter((p) => p.event === "agent.finished"),
    );
  });

  it("mirrors a local OS toggle to the account's os channel and back", () => {
    localStorage.setItem("bycoda.notifications.events.v1", JSON.stringify({ failed: false }));
    const server = defaultNotificationSettings();
    const first = mergeSettings({
      base: null,
      local: readLocalSnapshot(),
      server: readServerSnapshot(server),
    });
    expect(first.toServer["os:agent.failed"]).toBe(false);
    const sent = applyToServerSettings(server, first.toServer);
    expect(readServerSnapshot(sent)["os:agent.failed"]).toBe(false);

    // Later the account turns it on again from another device; this computer follows.
    const again = applyToServerSettings(sent, { "os:agent.failed": true });
    const second = mergeSettings({
      base: first.merged,
      local: readLocalSnapshot(),
      server: readServerSnapshot(again),
    });
    expect(second.toLocal).toEqual({ "os:agent.failed": true });
    writeLocalSnapshot(second.toLocal);
    expect(loadNotificationEvents().failed).toBe(true);
  });
});
