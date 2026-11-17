import { describe, expect, it } from "vitest";
import type { ProviderRateLimits } from "../../providers/model/rateLimits";
import {
  FAILOVER_HOLD_MS,
  LimitedAccounts,
  failoverAccountKey,
  pickAccountFailover,
  pickOrderFailover,
} from "./usageLimitFailover";

const limits = (usedPercent: number, status: ProviderRateLimits["status"] = "ok") =>
  ({
    provider: "claude",
    session: { usedPercent, windowMinutes: 300, resetsAt: 2_000 },
    weekly: null,
    monthly: null,
    resetCredits: null,
    updatedAt: 0,
    error: null,
    status,
  }) as ProviderRateLimits;

const entry = (id: string, harness: "claude" | "codex", providerAccountId?: string) => ({
  id,
  harness,
  model: `${harness}:model-${id}`,
  modelSettings: {},
  unknownLimit: "use" as const,
  ...(providerAccountId ? { providerAccountId } : {}),
});

describe("pickAccountFailover", () => {
  it("skips held, exhausted and unreadable accounts and keeps the model", async () => {
    const read: Record<string, ProviderRateLimits | Error> = {
      full: limits(100),
      offline: limits(0, "error"),
      broken: new Error("network"),
      spare: limits(40),
    };
    const target = await pickAccountFailover({
      harness: "claude",
      model: "claude:opus",
      accountIds: ["held", "full", "offline", "broken", "spare"],
      limited: (key) => key === failoverAccountKey("claude", "held"),
      readLimits: async (id) => {
        const value = read[id];
        if (value instanceof Error) throw value;
        if (!value) throw new Error("held account must not be read");
        return value;
      },
    });
    expect(target).toEqual({ harness: "claude", model: "claude:opus", providerAccountId: "spare" });
  });

  it("finds nothing when every other account is out of quota", async () => {
    await expect(
      pickAccountFailover({
        harness: "codex",
        model: "codex:gpt",
        accountIds: ["a"],
        limited: () => false,
        readLimits: async () => limits(100),
      }),
    ).resolves.toBeUndefined();
  });
});

describe("pickOrderFailover", () => {
  it("takes the first entry the Host does not skip and whose account is not limited", () => {
    const target = pickOrderFailover({
      entries: [
        entry("1", "claude"),
        entry("2", "claude", "work"),
        entry("3", "codex"),
        entry("4", "claude", "bycoda"),
      ],
      statuses: [
        { entryId: "2", skip: "belowLimit" },
        { entryId: "3", leftPercent: 0 },
      ],
      limited: (key) => key === failoverAccountKey("claude", "default"),
    });
    expect(target).toEqual({
      harness: "claude",
      model: "claude:model-4",
      providerAccountId: "bycoda",
    });
  });

  it("finds nothing in an empty order", () => {
    expect(pickOrderFailover({ entries: [], statuses: [], limited: () => false })).toBeUndefined();
  });
});

describe("LimitedAccounts", () => {
  it("holds until the reported reset, or for the default hold without one", () => {
    const held = new LimitedAccounts();
    held.hold("a", 0, 5_000);
    held.hold("b", 0);
    expect(held.has("a", 4_999)).toBe(true);
    expect(held.has("a", 5_000)).toBe(false);
    expect(held.has("b", FAILOVER_HOLD_MS - 1)).toBe(true);
    expect(held.has("b", FAILOVER_HOLD_MS)).toBe(false);
    expect(held.has("c", 0)).toBe(false);
  });
});
