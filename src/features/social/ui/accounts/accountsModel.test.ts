import { describe, expect, it } from "vitest";
import { DEFAULT_AUTONOMY, type AutonomyPolicy } from "../../model/autonomy";
import type { SocialAccount } from "../../model/social";
import {
  accountHealth,
  accountModeText,
  autonomyInputFrom,
  hasAutonomousLevel,
  levelText,
  parseCharacterLimit,
  parseDailyLimit,
  workingHoursError,
} from "./accountsModel";

const account = (patch: Partial<SocialAccount> = {}) =>
  ({
    id: "a1",
    platform: "x",
    name: "Studio",
    connected: true,
    paused: false,
    grants: {},
    connection: "browser",
    ...patch,
  }) as SocialAccount;

const NOW = Date.UTC(2026, 10, 7);

describe("accountHealth", () => {
  it("is ok for a connected account with no expired access or pending capability", () => {
    const health = accountHealth({
      account: account(),
      capabilities: [{ status: "available" }],
      needsHuman: false,
      now: NOW,
    });
    expect(health.status).toBe("ok");
  });

  it("is an error when access has expired", () => {
    expect(
      accountHealth({
        account: account({ expiresAt: NOW - 1 }),
        capabilities: [],
        needsHuman: false,
        now: NOW,
      }).status,
    ).toBe("error");
    expect(
      accountHealth({
        account: account(),
        capabilities: [{ status: "expired" }],
        needsHuman: false,
        now: NOW,
      }).status,
    ).toBe("error");
  });

  it("is a warning while a capability is pending or a screen waits for the owner", () => {
    expect(
      accountHealth({
        account: account(),
        capabilities: [{ status: "pending" }],
        needsHuman: false,
        now: NOW,
      }).status,
    ).toBe("warn");
    expect(
      accountHealth({ account: account(), capabilities: [], needsHuman: true, now: NOW }).status,
    ).toBe("warn");
  });

  it("is a warning with plain text for an account that is not connected yet", () => {
    const health = accountHealth({
      account: account({ connected: false }),
      capabilities: [],
      needsHuman: false,
      now: NOW,
    });
    expect(health).toEqual({ status: "warn", text: "Connection needed" });
  });
});

describe("account labels", () => {
  it("shows Browser only for browser connections; an account without a connection is API", () => {
    expect(accountModeText(account({ connection: "browser" }))).toBe("Browser");
    expect(accountModeText(account({ connection: undefined }))).toBe("API");
    expect(accountModeText(account({ connection: "oauth" }))).toBe("API");
  });

  it("names every autonomy level in plain words", () => {
    expect(levelText("suggest")).toBe("Suggest only");
    expect(levelText("approve")).toBe("Approve each");
    expect(levelText("autonomous")).toBe("Autonomous");
  });
});

describe("number and time validation", () => {
  it("treats an empty character limit as inherit and rejects values outside 1 to 20000", () => {
    expect(parseCharacterLimit("  ")).toEqual({ ok: true, value: undefined });
    expect(parseCharacterLimit("280")).toEqual({ ok: true, value: 280 });
    expect(parseCharacterLimit("0").ok).toBe(false);
    expect(parseCharacterLimit("20001").ok).toBe(false);
    expect(parseCharacterLimit("12.5").ok).toBe(false);
  });

  it("allows zero daily limits and caps them at one million", () => {
    expect(parseDailyLimit("0")).toEqual({ ok: true, value: 0 });
    expect(parseDailyLimit("1000001").ok).toBe(false);
  });

  it("reports working hours problems in plain words", () => {
    const base = { timeZone: "Europe/Istanbul", days: [1], start: "09:00", end: "17:00" };
    expect(workingHoursError(base)).toBeUndefined();
    expect(workingHoursError({ ...base, days: [] })).toBe("Choose at least one day.");
    expect(workingHoursError({ ...base, start: "9am" })).toBe("Use 24-hour times such as 09:00.");
    expect(workingHoursError({ ...base, timeZone: "Not/AZone" })).toBe("Choose a valid time zone.");
  });
});

describe("autonomy form", () => {
  it("sends only the fields the Host accepts for autonomy.set", () => {
    const policy: AutonomyPolicy = {
      accountId: "a1",
      version: 4,
      levels: { ...DEFAULT_AUTONOMY.levels, reply: "autonomous" },
      limits: { ...DEFAULT_AUTONOMY.limits },
      updatedAt: 1,
      updatedBy: "owner",
    };
    const input = autonomyInputFrom(policy);
    expect(Object.keys(input).sort()).toEqual(["levels", "limits"]);
    expect(hasAutonomousLevel(input.levels)).toBe(true);
  });

  it("finds no autonomous level in the default policy", () => {
    expect(hasAutonomousLevel(DEFAULT_AUTONOMY.levels)).toBe(false);
  });
});

it("summarizes only the operations that are available", async () => {
  const { capabilitySummary } = await import("./accountsModel");
  expect(
    capabilitySummary([
      { operation: "publish", status: "available" },
      { operation: "reply", status: "expired" },
      { operation: "message.start", status: "available" },
    ]),
  ).toBe("Post · Messages");
  expect(capabilitySummary([{ operation: "publish", status: "pending" }])).toBe("");
});
