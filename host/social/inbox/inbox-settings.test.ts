import { describe, expect, it, vi } from "vitest";
import { inboxActions } from "./inbox-actions";
import {
  INBOX_INTERVALS_KEY,
  pollIntervalMs,
  readInboxSettings,
  validateIntervals,
} from "./inbox-settings";
import { account, capability, inboxContext } from "./inbox-test-support";
import type { InboxSettings } from "./inbox-types";

vi.mock("../../../src/integrations/social/capabilities", () => ({
  accountCapabilities: (item: { caps: unknown[] }) => item.caps,
}));

const noOverrides: InboxSettings = { autoRefresh: true, intervals: {} };

describe("inbox auto-refresh default", () => {
  it("is on when no value is stored", async () => {
    const { ctx } = inboxContext();
    expect(await readInboxSettings(ctx.service)).toEqual(noOverrides);
  });

  it("is off only after an explicit stored false", async () => {
    const { ctx } = inboxContext();
    await ctx.service.setSetting("polling", "false");
    expect((await readInboxSettings(ctx.service)).autoRefresh).toBe(false);
    await ctx.service.setSetting("polling", "true");
    expect((await readInboxSettings(ctx.service)).autoRefresh).toBe(true);
  });

  it("ignores unreadable stored interval JSON instead of failing the read", async () => {
    const { ctx, settings } = inboxContext();
    settings.set(INBOX_INTERVALS_KEY, "{not json");
    expect(await readInboxSettings(ctx.service)).toEqual(noOverrides);
  });
});

describe("validateIntervals", () => {
  it("accepts known platforms with periods from 60 seconds to 24 hours", () => {
    expect(validateIntervals({ x: 60, youtube: 86_400 })).toEqual({ x: 60, youtube: 86_400 });
  });

  it.each([
    ["below the 60 s floor", { x: 59 }],
    ["above 24 h", { x: 86_401 }],
    ["a fraction", { x: 90.5 }],
    ["an unknown platform", { myspace: 120 }],
    ["an array", [60]],
  ])("rejects %s", (_label, value) => {
    expect(() => validateIntervals(value)).toThrow();
  });
});

describe("pollIntervalMs", () => {
  const plain = account("x-main", "x", [capability("webhook", "pending")]);
  const webhook = account("ig-main", "instagram", [capability("webhook", "available")]);

  it("polls every 60 seconds without a live webhook", () => {
    expect(pollIntervalMs(plain, noOverrides, 0)).toBe(60_000);
  });

  it("polls sparsely (15 minutes) when the webhook is live", () => {
    expect(pollIntervalMs(webhook, noOverrides, 0)).toBe(900_000);
  });

  it("polls a browser-session account every five minutes unless the owner overrides it", () => {
    const browser = { ...plain, connection: "browser" as const };
    expect(pollIntervalMs(browser, noOverrides, 0)).toBe(300_000);
    expect(pollIntervalMs(browser, { autoRefresh: true, intervals: { x: 60 } }, 0)).toBe(60_000);
  });

  it("uses the owner's period for the platform and never goes below 60 seconds", () => {
    expect(pollIntervalMs(plain, { autoRefresh: true, intervals: { x: 300 } }, 0)).toBe(300_000);
    expect(pollIntervalMs(plain, { autoRefresh: true, intervals: { x: 30 } }, 0)).toBe(60_000);
  });
});

describe("inbox.settings action", () => {
  it("is owner-only, stores auto-refresh under the legacy key and returns the effective values", async () => {
    expect(inboxActions["inbox.settings"]).toMatchObject({ ownerOnly: true, readOnly: false });
    const { ctx, settings } = inboxContext();
    const result = await inboxActions["inbox.settings"].run(ctx, {
      autoRefresh: false,
      intervals: { youtube: 120 },
    });
    expect(result).toEqual({ autoRefresh: false, intervals: { youtube: 120 } });
    expect(settings.get("polling")).toBe("false");
    expect(JSON.parse(settings.get(INBOX_INTERVALS_KEY) ?? "{}")).toEqual({ youtube: 120 });
  });

  it("rejects a non-boolean auto-refresh value", async () => {
    const { ctx } = inboxContext();
    await expect(inboxActions["inbox.settings"].run(ctx, { autoRefresh: "yes" })).rejects.toThrow(
      "Invalid auto-refresh setting.",
    );
  });
});
